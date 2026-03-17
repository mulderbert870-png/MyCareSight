# Quick Setup Guide

## 1. Install Dependencies

```bash
npm install
```

## 2. Set Up Supabase

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project
3. Go to **Project Settings > API**
4. Copy your **Project URL** and **anon/public key**

## 3. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 4. Run Database Migration

1. In Supabase dashboard, go to **SQL Editor**
2. Copy the contents of `supabase/migrations/001_initial_schema.sql`
3. Paste and run it in the SQL Editor
4. This will create:
   - `user_profiles` table
   - Row Level Security (RLS) policies
   - Automatic profile creation trigger

## 5. Start Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## 6. Create Your First User

You can create a user by:
- Using the signup page at `/signup`
- Or creating one directly in Supabase dashboard under **Authentication > Users**

## Notes

- The demo credentials on the login page are for UI testing only
- You'll need to create actual users through signup or Supabase dashboard
- Email confirmation can be disabled in Supabase settings if you want immediate login


