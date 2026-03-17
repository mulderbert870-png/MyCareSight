# Caregiver Invite Email – Supabase Dashboard Setup

When an agency admin adds a caregiver, Supabase sends the **Magic Link** email. To show your custom message (agency name and temporary password), set the template in the Supabase Dashboard.

## Where to edit

1. Open your project in [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **Authentication** → **Email Templates**.
3. Select the **Magic Link** template.

## Subject

```
You are invited to join MyCareSight!
```

## Message body (HTML)

Use this in the **Message body** field. The variables `{{ .Data.agency_name }}` and `{{ .Data.temporary_password }}` are filled from the invite; `{{ .ConfirmationURL }}` is the login link.

```html
<p>Your Agency ({{ .Data.agency_name }}) has invited you to join the team.</p>
<p>Your temporary password is {{ .Data.temporary_password }}.</p>
<p>Please click the link below to login and change your password:</p>
<p><a href="{{ .ConfirmationURL }}">Log in to MyCareSight</a></p>
```

## Variables used

| Variable | Description |
|---------|-------------|
| `{{ .Data.agency_name }}` | Name of the agency that invited the caregiver (from the app). |
| `{{ .Data.temporary_password }}` | Temporary password (e.g. lastname123!). |
| `{{ .ConfirmationURL }}` | One-time login link (Supabase). |

If `agency_name` is missing, the app sends `"Your Agency"` so the email still reads correctly.

## Note

- No Resend or other external mailer is required; this uses Supabase’s built-in auth emails.
- After saving the template in the Dashboard, new caregiver invites will use this subject and body.
