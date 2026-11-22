// Default email copy. Every template can be overridden from Admin → Emails
// (stored in the email_templates table) without a rebuild.
//
// Syntax:  {{var}}  ·  {{#if flag}}…{{/if}}  ·  {{#unless flag}}…{{/unless}}
//          **bold**  ·  [link text](url)  ·  [[Button label|url]] on its own line
// Blank line = new paragraph.
//
// Always-available variables: first_name, author, brand, site_url, amazon_url,
// activation_url, cohort_url, group_start_url, updates_list_name, when (event
// time in the reader's time zone), when_host (in the host's time zone).

export const TEMPLATES = {
  // ---------------- Activation ----------------
  activation_confirm: {
    label: 'Activation · confirmation + access',
    subject: "You're in: Free 45-Minute Activation, {{when_short}}",
    body: `Hi {{first_name}},

You're registered for the **Free 45-Minute Activation** with {{author}}.

**When:** {{when}}
**Where:** Zoom (link below, the same link opens the session)

[[Join on Zoom|{{zoom_url}}]]

A calendar invite is attached. We'll remind you 48 hours, 24 hours and 1 hour before we start.

See you there,
{{author}}`,
  },
  activation_reminder: {
    label: 'Activation · reminder (48h / 24h / 1h)',
    subject: 'Reminder: your Activation starts {{hours_label}}',
    body: `Hi {{first_name}},

Quick reminder: the **Free 45-Minute Activation** starts {{hours_label}}, on {{when}}.

[[Join on Zoom|{{zoom_url}}]]

Bring a notebook and something to drink. See you soon!`,
  },
  activation_next_steps: {
    label: 'Activation · post-session next steps',
    subject: 'Your next step after the Activation',
    body: `Hi {{first_name}},

Thank you for spending 45 minutes with us. Here's how to keep going:

**1. Get Volume One.** The book is the heart of the journey.
[[Buy Volume One on Amazon|{{amazon_url}}]]

{{#unless has_paid_cohort}}{{#if cohort_open}}**2. Join a Guided Cohort ($72).** Go through the book live with {{author}}, with weekly meetings, a productivity workspace and an accountability community.
[[See cohort dates|{{cohort_url}}]]

{{/if}}{{/unless}}{{#unless has_group}}**Gather your people.** Start your own Accountability Circle. When {{threshold}} people join, your circle unlocks a free 30-minute virtual visit with the author.
[[Start an Accountability Circle|{{group_start_url}}]]
{{/unless}}
With gratitude,
{{author}}`,
  },
  activation_cancelled: {
    label: 'Activation · session cancelled',
    subject: 'Change of plans: the {{when_short}} Activation is cancelled',
    body: `Hi {{first_name}},

We're sorry: the Activation on {{when}} has been cancelled. Please pick another date. It only takes a moment:

[[Choose a new date|{{activation_url}}]]`,
  },

  // ---------------- Cohort ----------------
  cohort_paid: {
    label: 'Cohort · payment confirmation',
    subject: 'Payment received: {{cohort_name}}',
    body: `Hi {{first_name}},

Your payment of **{{amount}}** for the **{{cohort_name}}** is confirmed. Stripe will also email you a receipt.

**Starts:** {{cohort_when}}
{{#if schedule_text}}**Schedule:** {{schedule_text}}{{/if}}

Reminder: the book is a separate purchase on Amazon.
[[Get Volume One|{{amazon_url}}]]`,
  },
  cohort_welcome: {
    label: 'Cohort · welcome',
    subject: 'Welcome to the {{cohort_name}}',
    body: `Hi {{first_name}},

Welcome! I'm so glad you're doing this journey with us.

Here's what happens next:
• A few days before we start you'll get your **digital workbook**, the **meeting link** and the full **schedule**.
• We'll remind you before every meeting.
• Got a question? Just reply to this email.

{{author}}`,
  },
  cohort_materials: {
    label: 'Cohort · materials + access (before start)',
    subject: 'Your workbook and meeting link: {{cohort_name}}',
    body: `Hi {{first_name}},

We start **{{cohort_when}}**. Everything you need is here:

{{#if workbook_url}}[[Download your workbook|{{workbook_url}}]]
{{/if}}
[[Meeting link (Zoom)|{{zoom_url}}]]

{{#if schedule_text}}**Schedule:** {{schedule_text}}{{/if}}

{{#if instructions}}{{instructions}}{{/if}}

Save this email. The same Zoom link works for every meeting.`,
  },
  cohort_meeting_reminder: {
    label: 'Cohort · meeting reminder (24h / 1h)',
    subject: '{{cohort_name}}: we meet {{hours_label}}',
    body: `Hi {{first_name}},

Our next cohort meeting is {{hours_label}}: **{{when}}**.

[[Join on Zoom|{{zoom_url}}]]`,
  },
  cohort_complete: {
    label: 'Cohort · completion follow-up',
    subject: 'You finished the {{cohort_name}} 🌱',
    body: `Hi {{first_name}},

You did it. Thank you for showing up, week after week.

Want to keep the momentum? Start your own Accountability Circle and pass it on. When {{threshold}} people join, your circle unlocks a free virtual visit with the author.

[[Start an Accountability Circle|{{group_start_url}}]]

I'd love to hear what changed for you. Just hit reply.

{{author}}`,
  },
  cohort_waitlist_joined: {
    label: 'Cohort · waitlist confirmation',
    subject: "You're on the waitlist for the next cohort",
    body: `Hi {{first_name}},

You're on the waitlist. We'll email you as soon as the next Guided Cohort opens.

In the meantime, the free Activation is a great place to start:
[[Pick an Activation date|{{activation_url}}]]`,
  },
  cohort_waitlist_open: {
    label: 'Cohort · waitlist: new cohort open',
    subject: 'The next cohort is open: {{cohort_name}}',
    body: `Hi {{first_name}},

You asked us to let you know, and enrollment for the **{{cohort_name}}** is now open (starts {{cohort_when}}). Seats are limited.

[[Save my seat|{{cohort_url}}]]`,
  },

  // ---------------- Groups ----------------
  group_created: {
    label: 'Circle leader · circle created + invite link',
    subject: 'Your Accountability Circle "{{group_name}}" is ready. Here is your invite link',
    body: `Hi {{first_name}},

Your Accountability Circle **{{group_name}}** is set up.

**Share this link with your members:**
{{invite_url}}

[[Copy and share your invite link|{{invite_url}}]]

**How it works**
• Send the link by text, email or group chat. Each person signs up in under a minute.
• Every person needs their own email address. Duplicates don't count twice.
• When **{{threshold}} people** have joined, your circle unlocks one complimentary 30-minute virtual visit with the author, and you'll get a booking link automatically.

**Your private circle dashboard** (member count, visit status, edit your schedule and goal):
[[Open my dashboard|{{dashboard_url}}]]

Keep this email. The dashboard link is private to you.`,
  },
  group_milestone: {
    label: 'Circle leader · member-count milestone',
    subject: '{{group_name}}: {{member_count}} of {{threshold}} have joined',
    body: `Hi {{first_name}},

**{{new_member_name}}** just joined **{{group_name}}**. You now have **{{member_count}} of {{threshold}}** members.

{{#if remaining}}Only **{{remaining}}** more to unlock your free virtual visit with {{author}}. Share your link again:
{{invite_url}}{{/if}}

[[View my dashboard|{{dashboard_url}}]]`,
  },
  group_eligible: {
    label: 'Circle leader · author visit unlocked + booking link',
    subject: '🎉 {{group_name}} unlocked a virtual visit with {{author}}',
    body: `Hi {{first_name}},

{{threshold}} people have joined **{{group_name}}**, so your circle has unlocked **one complimentary 30-minute virtual visit** with {{author}}.

Pick a time that works for your circle. You'll see only available times, shown in your time zone, and it's confirmed instantly.

[[Book our author visit|{{booking_url}}]]

You can book now or later. This link is private to your circle.`,
  },
  visit_unbooked_reminder: {
    label: 'Circle leader · visit not booked yet (7 & 14 days)',
    subject: 'Reminder: {{group_name}} still has a free author visit to book',
    body: `Hi {{first_name}},

Just a nudge: your circle's complimentary 30-minute visit with {{author}} is still waiting to be scheduled.

[[Choose a time|{{booking_url}}]]`,
  },
  group_links: {
    label: 'Circle leader · links resent (from dashboard)',
    subject: 'Your links for {{group_name}}',
    body: `Hi {{first_name}},

Here are your links for **{{group_name}}**, as requested.

**Invite link for members:**
{{invite_url}}

[[Open my circle dashboard|{{dashboard_url}}]]

{{#if eligible}}**Book or reschedule your author visit:**
[[Manage our author visit|{{booking_url}}]]
{{/if}}
Keep this email. These links are private to you.`,
  },
  member_confirm: {
    label: 'Circle member · registration confirmation',
    subject: "You've joined {{group_name}}",
    body: `Hi {{first_name}},

You're registered with **{{group_name}}**{{#if leader_name}}, led by {{leader_name}}{{/if}}. Your circle leader will share meeting details.

{{#unless purchased}}**Need the book?** Grab Volume One on Amazon before your first meeting:
[[Get Volume One|{{amazon_url}}]]

{{/unless}}Bought it since, or answered by mistake? [Update your answer]({{member_url}}).`,
  },

  // ---------------- Author visit ----------------
  visit_confirm: {
    label: 'Booked leader · visit confirmation',
    subject: 'Confirmed: author visit for {{group_name}}, {{when_short}}',
    body: `Hi {{first_name}},

Your complimentary virtual visit with {{author}} is **confirmed**.

**Circle:** {{group_name}}
**When:** {{when}}
**Length:** 30 minutes
**Where:** Zoom

[[Join on Zoom|{{zoom_url}}]]

Need to change it? You can reschedule or cancel anytime from your booking page (your circle keeps its one visit):
[[Reschedule or cancel|{{booking_url}}]]

A calendar invite is attached. We'll remind you 48 hours and 1 hour before.`,
  },
  visit_rescheduled: {
    label: 'Booked leader · rescheduled',
    subject: 'Rescheduled: author visit for {{group_name}} is now {{when_short}}',
    body: `Hi {{first_name}},

Your author visit has been moved.

**Was:** {{previous_when}}
**Now:** {{when}}

[[Join on Zoom|{{zoom_url}}]]

[[Manage booking|{{booking_url}}]]`,
  },
  visit_cancelled: {
    label: 'Booked leader · cancelled',
    subject: 'Cancelled: author visit for {{group_name}}',
    body: `Hi {{first_name}},

Your visit on {{previous_when}} has been cancelled. Your circle still has its complimentary visit, so you can book a new time whenever you're ready:

[[Book a new time|{{booking_url}}]]`,
  },
  visit_reminder: {
    label: 'Booked leader · reminder (48h / 1h)',
    subject: 'Reminder: author visit with {{author}} {{hours_label}}',
    body: `Hi {{first_name}},

Your circle's visit with {{author}} is {{hours_label}}: **{{when}}**.

[[Join on Zoom|{{zoom_url}}]]

Tip: have one person share a screen or a speaker so the whole circle can hear.`,
  },
  visit_author_notify: {
    label: 'Author · new / changed / cancelled visit',
    subject: 'Author visit {{change}}: {{group_name}}, {{when_short_host}}',
    body: `Author visit **{{change}}**.

**Circle:** {{group_name}} ({{member_count}} members)
**Leader:** {{leader_name}}, {{leader_email}}
{{#if group_goal}}**What they want to achieve:** {{group_goal}}{{/if}}
**When:** {{when_host}}
{{#if previous_when}}**Previously:** {{previous_when_host}}{{/if}}
**Zoom:** {{zoom_url}}

The attached invite updates your calendar. Your subscribed calendar feed updates automatically too.`,
  },

  // ---------------- Amazon pathway ----------------
  amazon_followup: {
    label: 'Reader · "don\'t do the journey alone" (after Amazon click)',
    subject: "Don't do the journey alone",
    body: `Hi {{first_name}},

Thanks for picking up Volume One. Powerful on your own. Even more powerful when you grow with others.

**Join a Guided Cohort ($72):** go through the book live with {{author}} and an accountability community.
[[See cohorts|{{cohort_url}}]]

**Start your own Accountability Circle:** invite friends, and when {{threshold}} join you unlock a free virtual visit with the author.
[[Start an Accountability Circle|{{group_start_url}}]]

**Not sure yet?** Start with the free 45-minute Activation.
[[Pick a date|{{activation_url}}]]`,
  },
};

// ---------------- renderer ----------------
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fill(tpl, vars, escape = true) {
  let s = tpl;
  // conditionals (non-greedy, supports nesting of different tags)
  for (let i = 0; i < 5; i++) {
    s = s.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, k, inner) => (truthy(vars[k]) ? inner : ''));
    s = s.replace(/\{\{#unless (\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_, k, inner) => (truthy(vars[k]) ? '' : inner));
  }
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => (escape ? escHtml(vars[k] ?? '') : String(vars[k] ?? '')));
}
const truthy = (v) => !(v === undefined || v === null || v === false || v === '' || v === 0 || v === 'false');

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2" style="color:#7a4b5b">$1</a>')
    .replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" style="color:#7a4b5b;word-break:break-all">$2</a>');
}

export function toHtml(body) {
  return body.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').map((line) => {
      const b = line.match(/^\[\[(.+?)\|(.+?)\]\]$/);
      if (b) return `<a href="${b[2]}" style="display:inline-block;background:#2f3a2f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;margin:6px 0">${b[1]}</a>`;
      return inline(line);
    });
    return `<p style="margin:0 0 16px">${lines.join('<br>')}</p>`;
  }).join('\n');
}

export function toText(body) {
  return body
    .replace(/^\[\[(.+?)\|(.+?)\]\]$/gm, '$1: $2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

export function layout(innerHtml, { brand, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f6f1ea;font-family:Georgia,'Times New Roman',serif;color:#2b2622">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1ea;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border-radius:14px;padding:32px 28px;font-size:17px;line-height:1.55">
<tr><td style="font-family:Georgia,serif;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#7a4b5b;padding-bottom:18px">${escHtml(brand)}</td></tr>
<tr><td style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${innerHtml}</td></tr>
</table>
<p style="max-width:560px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;color:#8a8077;line-height:1.5;margin:16px auto 0">${footer}</p>
</td></tr></table></body></html>`;
}

/** Render a template (with optional admin override) to {subject, html, text}. */
export function render(key, vars, override, { brand, unsubscribeUrl, kind }) {
  const t = override || TEMPLATES[key];
  if (!t) throw new Error('Unknown template ' + key);
  const subject = fill(t.subject, vars, false).replace(/\s+/g, ' ').trim();
  const filled = fill(t.body, vars, true).replace(/\n{3,}/g, '\n\n').trim();
  const footer = kind === 'transactional'
    ? `You're receiving this because you signed up on ${escHtml(vars.site_host || '')}. Replies go straight to our team.`
    : `You're receiving this because you registered with us. <a href="${unsubscribeUrl}" style="color:#8a8077">Unsubscribe from follow-ups</a>.`;
  return {
    subject,
    html: layout(toHtml(filled), { brand, footer }),
    text: toText(filled) + (kind === 'transactional' ? '' : `\n\nUnsubscribe: ${unsubscribeUrl}`),
  };
}
