-- =====================================================================
-- MallPay: let staff (not just admin) read WhatsApp message templates.
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Fixes a gap in migration-whatsapp-automation.sql: mallpay_whatsapp_templates
-- was admin-only for select+write, but staff also trigger template-based
-- notifications (Collect's payment-received message, Complaints' status
-- update). Under the old policy a staff session silently got no template
-- row back and always fell back to the built-in default wording — meaning
-- any custom wording an admin set was ignored for staff-triggered messages.
-- Only admin can still edit template wording.
-- =====================================================================

drop policy if exists whatsapp_templates_admin_all on public.mallpay_whatsapp_templates;

drop policy if exists whatsapp_templates_read on public.mallpay_whatsapp_templates;
create policy whatsapp_templates_read on public.mallpay_whatsapp_templates for select to authenticated
  using (public.my_role() in ('admin','staff'));

drop policy if exists whatsapp_templates_admin_write on public.mallpay_whatsapp_templates;
create policy whatsapp_templates_admin_write on public.mallpay_whatsapp_templates for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
