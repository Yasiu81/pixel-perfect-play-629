// Supabase Edge Function: send-family-visit-emails
//
// Wysyła raz dziennie (wywoływane przez Cron Job, patrz README w tym folderze)
// e-mail podsumowujący do rodziny każdego seniora, który miał tego dnia
// zrealizowaną (status = 'completed') wizytę, o ile dany członek rodziny ma
// "dostęp opiekuńczy" (family_access.dostep_opiekunczy = true).
//
// Wysyłka idzie przez SMTP skrzynki administracja@planseniora.pl, więc kopia
// każdej wiadomości trafia też do folderu „Wysłane” w Outlooku — to jest
// zamierzone (koordynator ma tam pełny wgląd), niezależnie od loga w tabeli
// `family_email_log`, który dodatkowo pokazuje to w samej aplikacji.
//
// Wymagane sekrety (supabase secrets set ...):
//   SMTP_HOST      (domyślnie smtp.office365.com)
//   SMTP_PORT      (domyślnie 587)
//   SMTP_USER      np. administracja@planseniora.pl
//   SMTP_PASSWORD  hasło skrzynki lub "hasło aplikacji" (App Password)
//
// Wywołanie ręczne (test): POST z body {"date": "2026-07-10"} — bez body
// domyślnie bierze dzisiejszą datę (UTC).

import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const smtpHost = Deno.env.get("SMTP_HOST") ?? "smtp.office365.com";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "587");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASSWORD");

    if (!smtpUser || !smtpPass) {
      return new Response(
        JSON.stringify({ error: "Brak skonfigurowanych sekretów SMTP_USER / SMTP_PASSWORD." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    let targetDate = new Date().toISOString().slice(0, 10);
    try {
      const body = await req.json();
      if (body?.date) targetDate = body.date;
    } catch {
      // brak body — użyj dzisiejszej daty
    }

    const dayStart = `${targetDate}T00:00:00`;
    const dayEnd = `${targetDate}T23:59:59`;

    const { data: visits, error: visitsErr } = await supabase
      .from("visits")
      .select(`
        id, planned_start, actual_start, actual_end, hours_billed, notes, senior_id, caregiver_id,
        senior:seniors(id, imie, nazwisko),
        caregiver:profiles(imie, nazwisko),
        tasks:visit_tasks(task_name, completed, uwagi)
      `)
      .eq("status", "completed")
      .gte("planned_start", dayStart)
      .lte("planned_start", dayEnd);

    if (visitsErr) throw visitsErr;
    if (!visits || visits.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: `Brak zrealizowanych wizyt dnia ${targetDate}.` }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const visitsBySenior = new Map<string, typeof visits>();
    for (const v of visits as any[]) {
      if (!v.senior_id) continue;
      if (!visitsBySenior.has(v.senior_id)) visitsBySenior.set(v.senior_id, []);
      visitsBySenior.get(v.senior_id)!.push(v);
    }

    const seniorIds = Array.from(visitsBySenior.keys());
    const { data: familyRows, error: famErr } = await supabase
      .from("family_access")
      .select("user_id, senior_id, dostep_opiekunczy, profiles:user_id(email, imie, nazwisko)")
      .in("senior_id", seniorIds)
      .eq("dostep_opiekunczy", true);
    if (famErr) throw famErr;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    let sentCount = 0;
    const errors: string[] = [];

    for (const fam of (familyRows ?? []) as any[]) {
      const seniorVisits = visitsBySenior.get(fam.senior_id) ?? [];
      if (seniorVisits.length === 0) continue;
      const recipientEmail: string | undefined = fam.profiles?.email;
      if (!recipientEmail) continue;

      const seniorInfo = seniorVisits[0].senior;
      const seniorLabel = seniorInfo ? `${seniorInfo.imie} ${seniorInfo.nazwisko}` : "senior";

      const htmlSections = seniorVisits.map((v: any) => {
        const start = v.actual_start
          ? new Date(v.actual_start).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
          : "—";
        const end = v.actual_end
          ? new Date(v.actual_end).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
          : "—";
        const caregiverLabel = v.caregiver ? `${v.caregiver.imie} ${v.caregiver.nazwisko}` : "opiekunka";
        const doneTasks = (v.tasks ?? []).filter((t: any) => t.completed).map((t: any) => t.task_name as string);
        const tasksHtml = doneTasks.length > 0
          ? `<ul style="margin:4px 0 0;padding-left:20px;">${doneTasks.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
          : `<p style="color:#888;margin:4px 0 0;">Brak zapisanych czynności.</p>`;
        const noteHtml = v.notes
          ? `<p style="margin:10px 0 0;"><strong>Notatka opiekunki:</strong> ${escapeHtml(v.notes)}</p>`
          : "";
        return `
          <div style="margin-bottom:16px;padding:14px 16px;border:1px solid #e2e2e2;border-radius:8px;">
            <p style="margin:0;"><strong>Godziny wizyty:</strong> ${start}–${end} &nbsp;·&nbsp; <strong>Opiekunka:</strong> ${escapeHtml(caregiverLabel)}</p>
            <p style="margin:10px 0 0;"><strong>Wykonane czynności:</strong></p>
            ${tasksHtml}
            ${noteHtml}
          </div>`;
      }).join("");

      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:600px;">
          <h2 style="color:#0F6E56;margin-bottom:4px;">Podsumowanie dnia opieki — ${escapeHtml(seniorLabel)}</h2>
          <p style="color:#555;margin-top:0;">${targetDate}</p>
          ${htmlSections}
          <p style="color:#888;font-size:12px;margin-top:24px;">
            Wiadomość wysłana automatycznie przez system Plan Seniora.
            W razie pytań prosimy o kontakt: administracja@planseniora.pl
          </p>
        </div>`;

      const visitIds = seniorVisits.map((v: any) => v.id);

      try {
        await transporter.sendMail({
          from: `"Plan Seniora" <${smtpUser}>`,
          to: recipientEmail,
          subject: `Podsumowanie dnia opieki — ${seniorLabel} (${targetDate})`,
          html,
        });
        sentCount++;
        await supabase.from("family_email_log").insert({
          recipient_user_id: fam.user_id,
          recipient_email: recipientEmail,
          senior_id: fam.senior_id,
          visit_date: targetDate,
          visit_ids: visitIds,
          status: "sent",
        });
      } catch (sendErr) {
        const msg = (sendErr as Error).message;
        errors.push(`${recipientEmail}: ${msg}`);
        await supabase.from("family_email_log").insert({
          recipient_user_id: fam.user_id,
          recipient_email: recipientEmail,
          senior_id: fam.senior_id,
          visit_date: targetDate,
          visit_ids: visitIds,
          status: "failed",
          error_message: msg,
        });
      }
    }

    return new Response(JSON.stringify({ sent: sentCount, errors }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
