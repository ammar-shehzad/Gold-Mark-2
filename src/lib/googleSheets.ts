import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";

const SHEET_NAME = "Invoices";
const HEADER = ["Invoice ID", "Shop Number", "Shop Name", "Period", "Amount", "Status", "Note", "Paid On", "Collected By"];
const LOCK_STALE_MS = 10 * 60_000; // a run older than this is assumed crashed and reclaimable

// =====================================================================
// Pure decision logic — no I/O, fully unit-testable without Google or a
// database. This is deliberately the only place the conflict policy is
// decided, so it can be exhaustively tested in isolation.
// =====================================================================

export type Fingerprint = { status: string; note: string | null } | null;
export type DbState = { status: string; note: string | null };
export type SheetState = { status: string | null; note: string | null } | null; // null = no matching sheet row

export type SyncAction =
  | { type: "none" }
  | { type: "applyToDb"; status: "paid" | "unpaid"; note: string | null }
  | { type: "exportToSheet" }
  | { type: "conflict" };

/**
 * Decides what should happen for one invoice given its current DB state,
 * current Sheet state, and the fingerprint recorded at the last successful
 * sync. Only 'status' and 'note' ever flow Sheet -> DB; everything else is
 * export-only. A missing/unmatched sheet row is never treated as a delete
 * or an import source — it just means "export this invoice."
 */
export function resolveSyncAction(db: DbState, sheet: SheetState, fingerprint: Fingerprint): SyncAction {
  if (!sheet) return { type: "exportToSheet" };

  const dbChanged = !fingerprint || db.status !== fingerprint.status || db.note !== fingerprint.note;
  const sheetChanged = !fingerprint || sheet.status !== fingerprint.status || sheet.note !== fingerprint.note;

  if (!dbChanged && !sheetChanged) return { type: "none" };

  if (sheetChanged && !dbChanged) {
    const normalized = sheet.status === "paid" || sheet.status === "unpaid" ? sheet.status : null;
    if (!normalized) return { type: "exportToSheet" }; // invalid value typed into the sheet — ignore it, re-export the true value
    return { type: "applyToDb", status: normalized, note: sheet.note };
  }

  if (dbChanged && !sheetChanged) return { type: "exportToSheet" };

  // both changed since the last sync
  if (db.status === sheet.status && db.note === sheet.note) return { type: "none" }; // changed to the same thing — not a real conflict
  return { type: "conflict" }; // DB wins — caller overwrites the sheet cell back to the DB value
}

// =====================================================================
// Google Sheets I/O
// =====================================================================

export type SheetRow = { rowNumber: number; invoiceId: number | null; status: string | null; note: string | null };

function buildOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and APP_URL must all be set");
  }
  return new google.auth.OAuth2(clientId, clientSecret, `${appUrl}/api/google/oauth/callback`);
}

/** Exported for the OAuth routes — same client construction, before any refresh token is known. */
export function getOAuthClient() {
  return buildOAuthClient();
}

function sheetsApiFor(refreshToken: string) {
  const oauth2 = buildOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: "v4", auth: oauth2 });
}

class SheetsClient {
  private api: sheets_v4.Sheets;
  constructor(refreshToken: string) {
    this.api = sheetsApiFor(refreshToken);
  }

  async ensureSpreadsheet(existingId: string | null): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
    if (existingId) {
      const res = await this.api.spreadsheets.get({ spreadsheetId: existingId });
      return { spreadsheetId: existingId, spreadsheetUrl: res.data.spreadsheetUrl! };
    }
    const res = await this.api.spreadsheets.create({
      requestBody: { properties: { title: "MallPay Invoice Ledger" }, sheets: [{ properties: { title: SHEET_NAME } }] },
    });
    const spreadsheetId = res.data.spreadsheetId!;
    await this.api.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER] },
    });
    return { spreadsheetId, spreadsheetUrl: res.data.spreadsheetUrl! };
  }

  async readAllRows(spreadsheetId: string): Promise<SheetRow[]> {
    const res = await this.api.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_NAME}!A2:I` });
    const values = res.data.values ?? [];
    return values.map((row, i) => ({
      rowNumber: i + 2,
      invoiceId: row[0] ? Number(row[0]) : null,
      status: row[5] ?? null,
      note: row[6] || null,
    }));
  }

  async writeRows(spreadsheetId: string, rows: { rowNumber: number; values: (string | number)[] }[]): Promise<void> {
    if (rows.length === 0) return;
    await this.api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: rows.map((r) => ({ range: `${SHEET_NAME}!A${r.rowNumber}:I${r.rowNumber}`, values: [r.values] })),
      },
    });
  }

  async appendRows(spreadsheetId: string, rows: (string | number)[][]): Promise<void> {
    if (rows.length === 0) return;
    await this.api.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
  }
}

// =====================================================================
// Orchestration
// =====================================================================

type Settings = {
  connected: boolean;
  refresh_token: string | null;
  spreadsheet_id: string | null;
  sync_running: boolean;
  sync_started_at: string | null;
};

async function claimLock(admin: ReturnType<typeof supabaseAdmin>): Promise<boolean> {
  const { data: current } = await admin
    .from("mallpay_google_sheets_settings")
    .select("sync_running,sync_started_at")
    .eq("id", true)
    .single();

  const staleOverride =
    current?.sync_running && current.sync_started_at && Date.now() - new Date(current.sync_started_at).getTime() > LOCK_STALE_MS;

  let query = admin
    .from("mallpay_google_sheets_settings")
    .update({ sync_running: true, sync_started_at: new Date().toISOString() })
    .eq("id", true);
  query = staleOverride ? query.eq("sync_running", true) : query.eq("sync_running", false);

  const { data } = await query.select("id");
  return (data?.length ?? 0) > 0;
}

async function releaseLock(admin: ReturnType<typeof supabaseAdmin>): Promise<void> {
  await admin.from("mallpay_google_sheets_settings").update({ sync_running: false }).eq("id", true);
}

type InvoiceRecord = {
  id: number;
  period: string;
  amount: number;
  status: string;
  note: string | null;
  paid_at: string | null;
  sheet_synced_status: string | null;
  sheet_synced_note: string | null;
  shops: { shop_number: string; name: string };
  profiles: { name: string } | null;
};

export type SyncResult = { exported: number; imported: number; conflicts: number; skipped: number };

export async function runFullSync(): Promise<SyncResult> {
  const admin = supabaseAdmin();
  const claimed = await claimLock(admin);
  if (!claimed) return { exported: 0, imported: 0, conflicts: 0, skipped: 0 };

  let result: SyncResult = { exported: 0, imported: 0, conflicts: 0, skipped: 0 };
  let errorMessage: string | null = null;

  try {
    const { data: settingsRaw } = await admin
      .from("mallpay_google_sheets_settings")
      .select("connected,refresh_token,spreadsheet_id,sync_running,sync_started_at")
      .eq("id", true)
      .single();
    const settings = settingsRaw as unknown as Settings | null;
    if (!settings?.connected || !settings.refresh_token || !settings.spreadsheet_id) {
      throw new Error("Google Sheets is not connected yet");
    }

    const client = new SheetsClient(decrypt(settings.refresh_token));
    const spreadsheetId = settings.spreadsheet_id;

    const { data: invoicesRaw } = await admin
      .from("invoices")
      .select("id,period,amount,status,note,paid_at,sheet_synced_status,sheet_synced_note,shops(shop_number,name),profiles:collected_by(name)")
      .order("id");
    const invoices = (invoicesRaw ?? []) as unknown as InvoiceRecord[];

    const sheetRows = await client.readAllRows(spreadsheetId);
    const sheetByInvoiceId = new Map(sheetRows.filter((r) => r.invoiceId != null).map((r) => [r.invoiceId as number, r]));

    const dbUpdates: { id: number; status: "paid" | "unpaid"; note: string | null }[] = [];
    const finalRowsToWrite: { invoiceId: number; rowNumber: number; sheetRowExists: boolean }[] = [];

    for (const inv of invoices) {
      const sheetRow = sheetByInvoiceId.get(inv.id) ?? null;
      const fingerprint: Fingerprint =
        inv.sheet_synced_status != null ? { status: inv.sheet_synced_status, note: inv.sheet_synced_note } : null;

      const action = resolveSyncAction(
        { status: inv.status, note: inv.note },
        sheetRow ? { status: sheetRow.status, note: sheetRow.note } : null,
        fingerprint
      );

      if (action.type === "applyToDb") {
        dbUpdates.push({ id: inv.id, status: action.status, note: action.note });
      } else if (action.type === "conflict") {
        result.conflicts++;
      }
      if (action.type === "exportToSheet" || action.type === "conflict" || action.type === "none") {
        finalRowsToWrite.push({ invoiceId: inv.id, rowNumber: sheetRow?.rowNumber ?? -1, sheetRowExists: !!sheetRow });
      }
    }

    // ---- Sheet -> DB, guarded against a stale read (a real collection recorded moments ago must win) ----
    const appliedIds = new Set<number>();
    for (const upd of dbUpdates) {
      const inv = invoices.find((i) => i.id === upd.id)!;
      const wasUnpaid = inv.status === "unpaid";
      const patch: Record<string, unknown> = { status: upd.status, note: upd.note };
      if (upd.status === "paid" && wasUnpaid) {
        patch.paid_at = new Date().toISOString();
        patch.collected_by = null;
      }
      if (upd.status === "unpaid" && !wasUnpaid) {
        patch.paid_at = null;
        patch.collected_by = null;
      }

      let q = admin.from("invoices").update(patch).eq("id", upd.id).eq("status", inv.status);
      q = inv.note == null ? q.is("note", null) : q.eq("note", inv.note);
      const { data: updated } = await q.select("id");

      if ((updated?.length ?? 0) > 0) {
        appliedIds.add(upd.id);
        result.imported++;
        finalRowsToWrite.push({
          invoiceId: upd.id,
          rowNumber: sheetByInvoiceId.get(upd.id)?.rowNumber ?? -1,
          sheetRowExists: sheetByInvoiceId.has(upd.id),
        });
      } else {
        // DB changed since we read it (e.g. a real payment was just collected) — skip the import,
        // the next sync will see the fresh DB value and export it instead.
        result.skipped++;
      }
    }

    // ---- Re-fetch final state for anything we touched, then write to the sheet + update fingerprints ----
    const idsNeedingWrite = [...new Set(finalRowsToWrite.map((r) => r.invoiceId))];
    const { data: freshRaw } = idsNeedingWrite.length
      ? await admin
          .from("invoices")
          .select("id,period,amount,status,note,paid_at,shops(shop_number,name),profiles:collected_by(name)")
          .in("id", idsNeedingWrite)
      : { data: [] as unknown[] };
    const freshById = new Map((freshRaw as unknown as InvoiceRecord[]).map((i) => [i.id, i]));

    const rowsToWrite: { rowNumber: number; values: (string | number)[] }[] = [];
    const rowsToAppend: (string | number)[][] = [];
    const fingerprintUpdates: { id: number; status: string; note: string | null }[] = [];

    for (const entry of finalRowsToWrite) {
      const inv = freshById.get(entry.invoiceId);
      if (!inv) continue;
      const values: (string | number)[] = [
        inv.id,
        inv.shops.shop_number,
        inv.shops.name,
        inv.period,
        Number(inv.amount),
        inv.status,
        inv.note ?? "",
        inv.paid_at ? new Date(inv.paid_at).toISOString().slice(0, 10) : "",
        inv.profiles?.name ?? "",
      ];
      if (entry.sheetRowExists && entry.rowNumber > 0) {
        rowsToWrite.push({ rowNumber: entry.rowNumber, values });
      } else {
        rowsToAppend.push(values);
      }
      fingerprintUpdates.push({ id: inv.id, status: inv.status, note: inv.note });
      if (!appliedIds.has(entry.invoiceId)) result.exported++;
    }

    await client.writeRows(spreadsheetId, rowsToWrite);
    await client.appendRows(spreadsheetId, rowsToAppend);

    for (const fp of fingerprintUpdates) {
      await admin
        .from("invoices")
        .update({ sheet_synced_status: fp.status, sheet_synced_note: fp.note, sheet_synced_at: new Date().toISOString() })
        .eq("id", fp.id);
    }

    await admin
      .from("mallpay_google_sheets_settings")
      .update({ last_synced_at: new Date().toISOString(), last_sync_status: "ok", last_sync_error: null })
      .eq("id", true);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    await admin
      .from("mallpay_google_sheets_settings")
      .update({ last_sync_status: "error", last_sync_error: errorMessage })
      .eq("id", true);
  } finally {
    await releaseLock(admin);
    await admin.from("mallpay_sheet_sync_log").insert({
      direction: "full",
      invoices_exported: result.exported,
      invoices_imported: result.imported,
      conflicts: result.conflicts,
      error: errorMessage,
    });
  }

  return result;
}

/** Used by the OAuth callback to create (or verify) the spreadsheet right after connecting. */
export async function ensureSpreadsheetForRefreshToken(
  refreshToken: string,
  existingId: string | null
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const client = new SheetsClient(refreshToken);
  return client.ensureSpreadsheet(existingId);
}

export { encrypt, decrypt };
