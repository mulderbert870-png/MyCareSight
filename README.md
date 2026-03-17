# Home Care Licensing - Next.js Starter Template

A complete authentication and user management system built with Next.js 15, TypeScript, Tailwind CSS, and Supabase.

## Features

🔐 **Authentication & User Management**
- Multi-role authentication system (Company Owner, Staff Member, Admin, Expert)
- Login/signup forms with validation
- User profile management with editable personal information
- Remember me functionality
- Password reset capability
- Demo credentials for quick testing

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database & Auth**: Supabase
- **Form Handling**: React Hook Form + Zod
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Supabase account (free tier works)
- npm, yarn, pnpm, or bun

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd nextjs-starter-template
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   # or
   pnpm install
   ```

3. **Set up Supabase**
   - Create a new project at [supabase.com](https://supabase.com)
   - Go to Project Settings > API
   - Copy your Project URL and anon/public key

4. **Configure environment variables**
   - Copy `.env.example` to `.env.local`
   ```bash
   cp .env.example .env.local
   ```
   - Fill in your Supabase credentials:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```
   - **Note:** `SUPABASE_SERVICE_ROLE_KEY` is required for agency admins to create caregiver/staff accounts (Admin API). Get it from Project Settings > API in Supabase. Never expose it in the browser.

5. **Set up the database schema**
   - In your Supabase dashboard, go to SQL Editor
   - Run the migration file: `supabase/migrations/001_initial_schema.sql`
   - This creates the `user_profiles` table and sets up Row Level Security (RLS)

6. **Run the development server**
   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   ```

7. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Demo Credentials

The login page includes quick access buttons with demo credentials:

- **Company Owner**: owner@demo.com / demo123
- **Admin**: admin@demo.com / demo123
- **Staff Member**: staff@demo.com / demo123
- **Expert**: expert@demo.com / demo123

> **Note**: These are demo credentials for UI testing. You'll need to create actual users through the signup form or Supabase dashboard for real authentication.

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── actions/          # Server actions
│   │   ├── dashboard/        # Protected dashboard page
│   │   ├── login/           # Login page
│   │   ├── signup/          # Signup page
│   │   ├── profile/         # User profile page
│   │   ├── reset-password/  # Password reset page
│   │   └── layout.tsx       # Root layout
│   ├── components/          # React components
│   ├── lib/
│   │   ├── supabase/        # Supabase client utilities
│   │   └── auth.ts          # Authentication helpers
│   └── types/               # TypeScript types
├── supabase/
│   └── migrations/          # Database migration files
├── middleware.ts            # Next.js middleware for auth
└── .env.local              # Environment variables (create this)
```

## Features in Detail

### Multi-Role Authentication

The system supports four user roles:
- **Company Owner**: Full access to manage company
- **Staff Member**: Access to assigned tasks and resources
- **Admin**: Administrative access to the platform
- **Expert**: Expert consultant access

Roles are stored in the `user_profiles` table and can be selected during signup or updated in the profile page.

### Protected Routes

The middleware automatically protects routes by checking authentication status. Unauthenticated users are redirected to the login page.

### User Profile Management

Users can:
- Update their full name
- Change their email (requires verification)
- Update their role
- View their account information

### Password Reset

Users can reset their password via email:
1. Click "Forgot password?" on the login page
2. Enter their email address
3. Receive a reset link via email
4. Set a new password

### Remember Me

When users check "Remember me" during login, their session is extended for a longer duration.

## Database Schema

### user_profiles

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key, references auth.users |
| email | TEXT | User's email address |
| full_name | TEXT | User's full name |
| role | TEXT | User role (company_owner, staff_member, admin, expert) |
| created_at | TIMESTAMP | Account creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon/public key | Yes |
| `NEXT_PUBLIC_SITE_URL` | Your site URL (for redirects) | No |

## Building for Production

```bash
npm run build
npm start
```

## Deployment

This project can be deployed to:
- **Vercel** (recommended for Next.js)
- **Netlify**
- **Any platform supporting Next.js**

Make sure to set your environment variables in your deployment platform.

## Customization

### Colors

The design uses a modern color palette. You can customize colors in:
- `tailwind.config.ts` - Tailwind configuration
- Individual component files - Component-level styling

### Styling

The project uses Tailwind CSS for styling. All authentication pages follow a consistent design system with:
- Rounded corners (rounded-xl, rounded-2xl, rounded-3xl)
- Gradient backgrounds
- Shadow effects
- Smooth transitions

## Support

For issues or questions, please open an issue in the repository.

## License

MIT License
