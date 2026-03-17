-- =============================================================================
-- HomeCareLicensing Production - Full Schema (merged from all migrations)
-- Run this on a fresh production database. Original migration files are unchanged.
-- =============================================================================

-- ========== 001_initial_schema.sql ==========
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('company_owner', 'staff_member', 'admin', 'expert')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE
  ON user_profiles FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies
-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create a function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff_member')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();



-- ========== 002_dashboard_schema.sql (part 1: through applications) ==========
-- Create licenses table
CREATE TABLE IF NOT EXISTS licenses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  state TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_number TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'expiring', 'expired', 'pending')) DEFAULT 'pending',
  activated_date DATE,
  expiry_date DATE NOT NULL,
  renewal_due_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_licenses_owner ON licenses(company_owner_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expiry_date);

-- Create license_documents table
CREATE TABLE IF NOT EXISTS license_documents (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  license_id UUID REFERENCES licenses(id) ON DELETE CASCADE NOT NULL,
  document_name TEXT NOT NULL,
  document_url TEXT NOT NULL,
  document_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_documents_license ON license_documents(license_id);

-- Create applications table
CREATE TABLE IF NOT EXISTS applications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  state TEXT NOT NULL,
  application_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'under_review', 'needs_revision', 'approved', 'rejected')) DEFAULT 'in_progress',
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  started_date DATE NOT NULL,
  last_updated_date DATE NOT NULL,
  submitted_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_owner ON applications(company_owner_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
-- ========== 079_application_steps_schema.sql ==========
-- Create application_steps table (per-application checklist steps, from license_requirement_steps).
-- Run before 002_dashboard_schema.sql (002 alters this table to add instructions).
-- Later: 052 adds is_expert_step, created_by_expert_id, description; 069 adds phase; 073/052 add RLS; 075/076 add triggers.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS application_steps (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  instructions TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE (application_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_application_steps_application ON application_steps(application_id);
CREATE INDEX IF NOT EXISTS idx_application_steps_order ON application_steps(application_id, step_order);

-- Trigger for updated_at (assumes update_updated_at_column() exists from 001)
CREATE TRIGGER update_application_steps_updated_at
  BEFORE UPDATE ON application_steps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS: company owners can manage steps for their own applications (073 refines these; 052 adds expert/admin)
ALTER TABLE application_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company owners can view own application steps"
  ON application_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can insert own application steps"
  ON application_steps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can update own application steps"
  ON application_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can delete own application steps"
  ON application_steps FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );
-- ========== applications.assigned_expert_id (required by 002 part 2 RLS) ==========
ALTER TABLE applications ADD COLUMN IF NOT EXISTS assigned_expert_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_applications_assigned_expert ON applications(assigned_expert_id) WHERE assigned_expert_id IS NOT NULL;
-- ========== 002_dashboard_schema.sql (part 2: application_steps alter and rest) ==========
alter table application_steps
  add column if not exists instructions text;
  
-- Create application_documents table
CREATE TABLE IF NOT EXISTS application_documents (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE NOT NULL,
  document_name TEXT NOT NULL,
  document_url TEXT NOT NULL,
  document_type TEXT,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_application_documents_application ON application_documents(application_id);

-- Create staff_members table
CREATE TABLE IF NOT EXISTS staff_members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL,
  job_title TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'pending')) DEFAULT 'active',
  employee_id TEXT,
  start_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_members_owner ON staff_members(company_owner_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_user ON staff_members(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_status ON staff_members(status);

-- Create staff_licenses table (for staff certifications and licenses)
CREATE TABLE IF NOT EXISTS staff_licenses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  staff_member_id UUID REFERENCES staff_members(id) ON DELETE CASCADE NOT NULL,
  license_type TEXT NOT NULL,
  license_number TEXT NOT NULL,
  state TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'expiring', 'expired')) DEFAULT 'active',
  issue_date DATE,
  expiry_date DATE NOT NULL,
  days_until_expiry INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_licenses_staff ON staff_licenses(staff_member_id);
CREATE INDEX IF NOT EXISTS idx_staff_licenses_status ON staff_licenses(status);
CREATE INDEX IF NOT EXISTS idx_staff_licenses_expiry ON staff_licenses(expiry_date);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('license_expiring', 'license_expired', 'application_update', 'document_approved', 'document_rejected', 'staff_certification_expiring', 'general')) DEFAULT 'general',
  icon_type TEXT CHECK (icon_type IN ('exclamation', 'document', 'bell', 'check', 'warning')),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- Add triggers for updated_at
CREATE TRIGGER update_licenses_updated_at BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_staff_members_updated_at BEFORE UPDATE ON staff_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_staff_licenses_updated_at BEFORE UPDATE ON staff_licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for licenses
CREATE POLICY "Company owners can view own licenses"
  ON licenses FOR SELECT
  USING (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can insert own licenses"
  ON licenses FOR INSERT
  WITH CHECK (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can update own licenses"
  ON licenses FOR UPDATE
  USING (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can delete own licenses"
  ON licenses FOR DELETE
  USING (auth.uid() = company_owner_id);

-- RLS Policies for license_documents
CREATE POLICY "Company owners can view own license documents"
  ON license_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM licenses WHERE licenses.id = license_documents.license_id AND licenses.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can insert own license documents"
  ON license_documents FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM licenses WHERE licenses.id = license_documents.license_id AND licenses.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can update own license documents"
  ON license_documents FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM licenses WHERE licenses.id = license_documents.license_id AND licenses.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can delete own license documents"
  ON license_documents FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM licenses WHERE licenses.id = license_documents.license_id AND licenses.company_owner_id = auth.uid()
  ));

-- RLS Policies for applications
CREATE POLICY "Company owners can view own applications"
  ON applications FOR SELECT
  USING (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can insert own applications"
  ON applications FOR INSERT
  WITH CHECK (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can update own applications"
  ON applications FOR UPDATE
  USING (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can delete own applications"
  ON applications FOR DELETE
  USING (auth.uid() = company_owner_id);

-- RLS Policies for application_documents
CREATE POLICY "Company owners can view own application documents"
  ON application_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM applications WHERE applications.id = application_documents.application_id AND applications.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can insert own application documents"
  ON application_documents FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM applications WHERE applications.id = application_documents.application_id AND applications.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can update own application documents"
  ON application_documents FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM applications WHERE applications.id = application_documents.application_id AND applications.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can delete own application documents"
  ON application_documents FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM applications WHERE applications.id = application_documents.application_id AND applications.company_owner_id = auth.uid()
  ));

-- Admins can view all application documents
DROP POLICY IF EXISTS "Admins can view all application documents" ON application_documents;
CREATE POLICY "Admins can view all application documents"
  ON application_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Experts can view own application documents"
  ON application_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM applications WHERE applications.id = application_documents.application_id AND applications.assigned_expert_id = auth.uid()
  ));

-- Experts can view documents for assigned applications (explicit policy)
DROP POLICY IF EXISTS "Experts can view assigned application documents" ON application_documents;
CREATE POLICY "Experts can view assigned application documents"
  ON application_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM applications WHERE applications.id = application_documents.application_id AND applications.assigned_expert_id = auth.uid()
  ));

CREATE POLICY "Experts can update own application documents"
  ON application_documents FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM applications WHERE applications.id = application_documents.application_id AND applications.assigned_expert_id = auth.uid()
  ));




-- RLS Policies for staff_members
CREATE POLICY "Company owners can view own staff"
  ON staff_members FOR SELECT
  USING (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can insert own staff"
  ON staff_members FOR INSERT
  WITH CHECK (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can update own staff"
  ON staff_members FOR UPDATE
  USING (auth.uid() = company_owner_id);

CREATE POLICY "Company owners can delete own staff"
  ON staff_members FOR DELETE
  USING (auth.uid() = company_owner_id);

-- RLS Policies for staff_licenses
CREATE POLICY "Company owners can view own staff licenses"
  ON staff_licenses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM staff_members WHERE staff_members.id = staff_licenses.staff_member_id AND staff_members.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can insert own staff licenses"
  ON staff_licenses FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM staff_members WHERE staff_members.id = staff_licenses.staff_member_id AND staff_members.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can update own staff licenses"
  ON staff_licenses FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM staff_members WHERE staff_members.id = staff_licenses.staff_member_id AND staff_members.company_owner_id = auth.uid()
  ));

CREATE POLICY "Company owners can delete own staff licenses"
  ON staff_licenses FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM staff_members WHERE staff_members.id = staff_licenses.staff_member_id AND staff_members.company_owner_id = auth.uid()
  ));

-- Staff members can view their own licenses
DROP POLICY IF EXISTS "Staff members can view own licenses" ON staff_licenses;
CREATE POLICY "Staff members can view own licenses"
  ON staff_licenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_members
      WHERE staff_members.id = staff_licenses.staff_member_id
      AND staff_members.user_id = auth.uid()
    )
  );

-- RLS Policies for notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notifications"
  ON notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Function to update days_until_expiry for staff_licenses
CREATE OR REPLACE FUNCTION update_staff_license_expiry_days()
RETURNS TRIGGER AS $$
BEGIN
  NEW.days_until_expiry = NEW.expiry_date - CURRENT_DATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_staff_license_expiry_days_trigger
  BEFORE INSERT OR UPDATE ON staff_licenses
  FOR EACH ROW
  EXECUTE FUNCTION update_staff_license_expiry_days();




-- Add description and expert_review_notes fields to application_documents table

ALTER TABLE application_documents
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS expert_review_notes TEXT;

-- Add comment for documentation
COMMENT ON COLUMN application_documents.description IS 'Description provided by the client when uploading the document';
COMMENT ON COLUMN application_documents.expert_review_notes IS 'Review notes provided by the expert when approving or rejecting the document';


-- Run this in Supabase SQL Editor
ALTER TABLE license_documents
ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE INDEX IF NOT EXISTS idx_license_documents_expiry_date ON license_documents(expiry_date);

-- add instrunctions column to application_steps (IF NOT EXISTS; 079 already creates table with it)
ALTER TABLE application_steps
  ADD COLUMN IF NOT EXISTS instructions text;
-- ========== 003_admin_dashboard_schema.sql (category moved to 066) ==========
-- Admin Dashboard Schema Migration
-- This migration creates all tables needed for the admin dashboard

-- Create clients table (companies managed by the system)
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'pending')) DEFAULT 'active',
  expert_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_expert ON clients(expert_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_company_name ON clients(company_name);

-- Create agencies table (companies that can be tied to one or more agency admins / clients)
CREATE TABLE IF NOT EXISTS agencies (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  agency_admin_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agencies_agency_admin_ids ON agencies USING GIN (agency_admin_ids);
CREATE TRIGGER update_agencies_updated_at BEFORE UPDATE ON agencies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all agencies" ON agencies FOR SELECT USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));
CREATE POLICY "Admins can insert agencies" ON agencies FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));
CREATE POLICY "Admins can update agencies" ON agencies FOR UPDATE USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));
CREATE POLICY "Admins can delete agencies" ON agencies FOR DELETE USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'));

ALTER TABLE agencies ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS primary_license_number TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS physical_street_address TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS physical_city TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS physical_state TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS physical_zip_code TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS same_as_physical BOOLEAN DEFAULT true;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mailing_street_address TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mailing_city TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mailing_state TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mailing_zip_code TEXT;

CREATE POLICY "Company owners can view own agency" ON agencies FOR SELECT USING (EXISTS (SELECT 1 FROM clients c WHERE c.company_owner_id = auth.uid() AND c.id = ANY(agencies.agency_admin_ids)));
CREATE POLICY "Company owners can insert own agency" ON agencies FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.company_owner_id = auth.uid() AND c.id = ANY(agencies.agency_admin_ids)));
CREATE POLICY "Company owners can update own agency" ON agencies FOR UPDATE USING (EXISTS (SELECT 1 FROM clients c WHERE c.company_owner_id = auth.uid() AND c.id = ANY(agencies.agency_admin_ids)));
-- Create client_states table (many-to-many relationship for clients and states)
CREATE TABLE IF NOT EXISTS client_states (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(client_id, state)
);

CREATE INDEX IF NOT EXISTS idx_client_states_client ON client_states(client_id);

-- Create licensing_experts table
CREATE TABLE IF NOT EXISTS licensing_experts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'Licensing Specialist',
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  expertise TEXT, -- e.g., "Home Healthcare, Skilled Nursing"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_licensing_experts_user ON licensing_experts(user_id);
CREATE INDEX IF NOT EXISTS idx_licensing_experts_status ON licensing_experts(status);

-- Create expert_states table (many-to-many for experts and their state specializations)
CREATE TABLE IF NOT EXISTS expert_states (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  expert_id UUID REFERENCES licensing_experts(id) ON DELETE CASCADE NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(expert_id, state)
);

CREATE INDEX IF NOT EXISTS idx_expert_states_expert ON expert_states(expert_id);

-- Create conversations table (for messaging system)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  expert_id UUID REFERENCES licensing_experts(id) ON DELETE SET NULL,
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_expert ON conversations(expert_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

-- Add application_id and admin_id early so RLS policies (e.g. user_profiles) can reference them
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_application ON conversations(application_id);
CREATE INDEX IF NOT EXISTS idx_conversations_admin ON conversations(admin_id);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(is_read);

-- Create license_requirements table (license types and their requirements)
CREATE TABLE IF NOT EXISTS license_requirements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  state TEXT NOT NULL,
  license_type TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(state, license_type)
);

CREATE INDEX IF NOT EXISTS idx_license_requirements_state ON license_requirements(state);

-- Create license_requirement_steps table
CREATE TABLE IF NOT EXISTS license_requirement_steps (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  license_requirement_id UUID REFERENCES license_requirements(id) ON DELETE CASCADE NOT NULL,
  step_name TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requirement_steps_requirement ON license_requirement_steps(license_requirement_id);
CREATE INDEX IF NOT EXISTS idx_requirement_steps_order ON license_requirement_steps(license_requirement_id, step_order);



-- add instructions column to license_requirement_steps
ALTER TABLE license_requirement_steps
  ADD COLUMN instructions text;

  
-- Create license_requirement_documents table
CREATE TABLE IF NOT EXISTS license_requirement_documents (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  license_requirement_id UUID REFERENCES license_requirements(id) ON DELETE CASCADE NOT NULL,
  document_name TEXT NOT NULL,
  document_type TEXT,
  description TEXT,
  is_required BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requirement_documents_requirement ON license_requirement_documents(license_requirement_id);

-- Create cases table (admin view of applications)
CREATE TABLE IF NOT EXISTS cases (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  case_id TEXT UNIQUE NOT NULL, -- e.g., "CASE-001"
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'under_review', 'needs_revision', 'approved', 'rejected')) DEFAULT 'in_progress',
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  expert_id UUID REFERENCES licensing_experts(id) ON DELETE SET NULL,
  documents_count INTEGER DEFAULT 0,
  steps_count INTEGER DEFAULT 0,
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  started_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_client ON cases(client_id);
CREATE INDEX IF NOT EXISTS idx_cases_expert ON cases(expert_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_state ON cases(state);
CREATE INDEX IF NOT EXISTS idx_cases_case_id ON cases(case_id);

-- Create billing table
CREATE TABLE IF NOT EXISTS billing (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  billing_month DATE NOT NULL, -- First day of the billing month
  user_licenses_count INTEGER DEFAULT 0,
  user_license_rate DECIMAL(10, 2) DEFAULT 50.00, -- per license per month
  applications_count INTEGER DEFAULT 0,
  application_rate DECIMAL(10, 2) DEFAULT 500.00, -- per application
  total_amount DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'overdue')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(client_id, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_billing_client ON billing(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_month ON billing(billing_month);
CREATE INDEX IF NOT EXISTS idx_billing_status ON billing(status);

-- Add triggers for updated_at
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_licensing_experts_updated_at BEFORE UPDATE ON licensing_experts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_license_requirements_updated_at BEFORE UPDATE ON license_requirements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cases_updated_at BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_billing_updated_at BEFORE UPDATE ON billing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update conversation last_message_at when a message is created
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at,
      updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversation_last_message_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message();

-- Enable Row Level Security
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing_experts ENABLE ROW LEVEL SECURITY;
ALTER TABLE expert_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_requirement_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_requirement_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing ENABLE ROW LEVEL SECURITY;

-- RLS Policies for clients (admins can manage all clients)
CREATE POLICY "Admins can view all clients"
  ON clients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert clients"
  ON clients FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update clients"
  ON clients FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete clients"
  ON clients FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for client_states
CREATE POLICY "Admins can manage client states"
  ON client_states FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for licensing_experts
CREATE POLICY "Admins can view all experts"
  ON licensing_experts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage experts"
  ON licensing_experts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for expert_states
CREATE POLICY "Admins can manage expert states"
  ON expert_states FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for conversations (admins and experts can view)
CREATE POLICY "Admins and experts can view conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND (user_profiles.role = 'admin' OR user_profiles.role = 'expert')
    )
  );

CREATE POLICY "Admins and experts can manage conversations"
  ON conversations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND (user_profiles.role = 'admin' OR user_profiles.role = 'expert')
    )
  );

-- RLS Policies for messages
CREATE POLICY "Admins and experts can view messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND (user_profiles.role = 'admin' OR user_profiles.role = 'expert')
    )
  );

CREATE POLICY "Admins and experts can manage messages"
  ON messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND (user_profiles.role = 'admin' OR user_profiles.role = 'expert')
    )
  );

-- RLS Policies for license_requirements
CREATE POLICY "Admins can manage license requirements"
  ON license_requirements FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for license_requirement_steps
CREATE POLICY "Admins can manage requirement steps"
  ON license_requirement_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for license_requirement_documents
CREATE POLICY "Admins can manage requirement documents"
  ON license_requirement_documents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for cases
CREATE POLICY "Admins can view all cases"
  ON cases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage cases"
  ON cases FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for billing
CREATE POLICY "Admins can view all billing"
  ON billing FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can manage billing"
  ON billing FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- Update user_profiles RLS to allow admins to view all profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  USING (
    auth.uid() = id OR
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() 
      AND up.role = 'admin'
    )
  );


-- ========== 004_staff_dashboard_rls.sql ==========
-- Staff Dashboard RLS Policies
-- This migration adds RLS policies to allow staff members to view their own licenses

-- Add RLS policies for staff_members to allow staff to view their own record
DROP POLICY IF EXISTS "Staff members can view own record" ON staff_members;
CREATE POLICY "Staff members can view own record"
  ON staff_members FOR SELECT
  USING (user_id = auth.uid());

-- -- Add RLS policies for staff_licenses to allow staff to view their own licenses
-- DROP POLICY IF EXISTS "Staff members can view own licenses" ON staff_licenses;
-- CREATE POLICY "Staff members can view own licenses"
--   ON staff_licenses FOR SELECT
--   USING (EXISTS (
--     SELECT 1 FROM staff_members 
--     WHERE staff_members.id = staff_licenses.staff_member_id 
--     AND staff_members.user_id = auth.uid()
--   ));

-- Add RLS policies for applications to allow staff to view their own licenses.
DROP POLICY IF EXISTS "Staff members can view own licenses" ON applications;
CREATE POLICY "Staff members can view own licenses"
  ON applications FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM staff_members 
    WHERE staff_members.id is not null 
    AND staff_members.user_id = auth.uid()
  ));



-- Add issuing_authority column to staff_licenses if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'staff_licenses' 
    AND column_name = 'issuing_authority'
  ) THEN
    ALTER TABLE staff_licenses ADD COLUMN issuing_authority TEXT;
  END IF;
END $$;


-- ========== 005_expert_dashboard_rls.sql ==========
-- Expert Dashboard RLS Policies
-- This migration adds RLS policies to allow experts to view their assigned clients, cases, and messages

-- RLS Policies for clients (experts can view their assigned clients)
DROP POLICY IF EXISTS "Experts can view assigned clients" ON clients;
CREATE POLICY "Experts can view assigned clients"
  ON clients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND expert_id = auth.uid()
  );

-- RLS Policies for cases (experts can view their assigned cases)
DROP POLICY IF EXISTS "Experts can view assigned cases" ON cases;
CREATE POLICY "Experts can view assigned cases"
  ON cases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = cases.expert_id
    )
  );

-- RLS Policies for conversations (experts can view conversations with their clients)
DROP POLICY IF EXISTS "Experts can view own conversations" ON conversations;
CREATE POLICY "Experts can view own conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
  );

-- RLS Policies for messages (experts can view and send messages in their conversations)
DROP POLICY IF EXISTS "Experts can view own messages" ON messages;
CREATE POLICY "Experts can view own messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND (
      sender_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM conversations
        JOIN licensing_experts ON licensing_experts.id = conversations.expert_id
        WHERE conversations.id = messages.conversation_id
        AND licensing_experts.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Experts can insert messages" ON messages;
CREATE POLICY "Experts can insert messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      JOIN licensing_experts ON licensing_experts.id = conversations.expert_id
      WHERE conversations.id = messages.conversation_id
      AND licensing_experts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Experts can update own messages" ON messages;
CREATE POLICY "Experts can update own messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND sender_id = auth.uid()
  );

-- Allow experts to create conversations with their assigned clients
DROP POLICY IF EXISTS "Experts can create conversations" ON conversations;
CREATE POLICY "Experts can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.expert_id = auth.uid()
    )
  );

-- Allow experts to update conversations (for last_message_at)
DROP POLICY IF EXISTS "Experts can update own conversations" ON conversations;
CREATE POLICY "Experts can update own conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
  );

-- Allow experts to view licensing_experts record for themselves
DROP POLICY IF EXISTS "Experts can view own expert record" ON licensing_experts;
CREATE POLICY "Experts can view own expert record"
  ON licensing_experts FOR SELECT
  USING (user_id = auth.uid());


-- ========== 006_demo_accounts.sql ==========
-- Demo accounts are not created in production (no owner@demo.com, admin@demo.com, staff@demo.com, expert@demo.com).

-- ========== 007_fix_user_profiles_rls_recursion.sql ==========
-- ============================================================================
-- Fix Infinite Recursion in user_profiles RLS Policy
-- ============================================================================
-- This migration fixes the infinite recursion error by creating a helper
-- function that checks user roles from auth.users metadata instead of
-- querying user_profiles within its own RLS policy.
-- ============================================================================

-- Create a security definer function to check user role without triggering RLS
-- SECURITY DEFINER functions run with the privileges of the function owner,
-- which bypasses RLS. This prevents infinite recursion when checking roles.
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Read from user_profiles directly
  -- SECURITY DEFINER ensures this runs with elevated privileges, bypassing RLS
  SELECT role INTO user_role
  FROM public.user_profiles
  WHERE id = user_id
  LIMIT 1;
  
  -- Fallback to auth.users metadata if not found in user_profiles
  IF user_role IS NULL THEN
    SELECT COALESCE(
      (raw_user_meta_data->>'role')::TEXT,
      'staff_member'
    ) INTO user_role
    FROM auth.users
    WHERE id = user_id
    LIMIT 1;
  END IF;
  
  RETURN COALESCE(user_role, 'staff_member');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Create a function to check if current user has a specific role
CREATE OR REPLACE FUNCTION public.is_user_role(role_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.get_user_role(auth.uid()) = role_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Drop the problematic policy that causes infinite recursion
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

-- Recreate the policy using the helper function (which bypasses RLS)
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  USING (
    auth.uid() = id OR
    public.is_user_role('admin')
  );

-- Company owners can view messaging profiles (experts and admins they have conversations with)
DROP POLICY IF EXISTS "Company owners can view messaging profiles" ON user_profiles;
CREATE POLICY "Company owners can view messaging profiles"
  ON user_profiles FOR SELECT
  USING (
    public.is_user_role('company_owner')
    AND (
      EXISTS (
        SELECT 1 FROM applications
        WHERE applications.company_owner_id = auth.uid()
        AND applications.assigned_expert_id = user_profiles.id
      )
      OR EXISTS (
        SELECT 1 FROM conversations c
        INNER JOIN applications a ON a.id = c.application_id
        WHERE a.company_owner_id = auth.uid()
        AND c.admin_id = user_profiles.id
      )
    )
  );

-- Experts can view messaging profiles (company owners/clients they are assigned to)
DROP POLICY IF EXISTS "Experts can view messaging profiles" ON user_profiles;
CREATE POLICY "Experts can view messaging profiles"
  ON user_profiles FOR SELECT
  USING (
    public.is_user_role('expert')
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.assigned_expert_id = auth.uid()
      AND applications.company_owner_id = user_profiles.id
    )
  );

-- Also update all other policies that query user_profiles to use the helper function
-- This prevents similar recursion issues in other policies

-- Update admin policies in other tables to use the helper function
-- (These don't cause recursion but it's good practice for consistency)

-- Note: The policies in 003_admin_dashboard_schema.sql and 005_expert_dashboard_rls.sql
-- that query user_profiles for other tables (not user_profiles itself) don't cause
-- infinite recursion because they're querying user_profiles from a different table's policy.
-- However, if you want to optimize them, you could use the helper function there too.


-- ========== 008_create_demo_staff_member.sql ==========
-- ============================================================================
-- Create Demo Staff Member Record
-- ============================================================================
-- This migration creates a staff_members record for the demo staff user
-- so they can access the staff dashboard.

-- Demo staff member creation skipped in production (no demo users).
DO $$ BEGIN NULL; END $$;


-- ========== 009_auto_create_staff_member.sql ==========
-- Auto-create staff_member records for new staff signups
-- This migration updates the handle_new_user function to automatically create
-- a staff_members record when a user signs up with the staff_member role

-- First, allow staff members to insert their own staff_member record
DROP POLICY IF EXISTS "Staff members can insert own record" ON staff_members;
CREATE POLICY "Staff members can insert own record"
  ON staff_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Update the handle_new_user function to also create staff_member records
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
  user_full_name TEXT;
  first_name_part TEXT;
  last_name_part TEXT;
  company_owner_uuid UUID;
  staff_member_id UUID;
BEGIN
  -- Get role and full_name from metadata
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'staff_member');
  user_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  
  -- Create user profile
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    user_full_name,
    user_role
  );
  
  -- If role is staff_member, create staff_member record
  IF user_role = 'staff_member' THEN
    -- Find the first company owner to assign as company_owner_id
    -- If no company owner exists, we'll skip creating the staff_member record
    -- and let the user contact an administrator
    SELECT id INTO company_owner_uuid
    FROM public.user_profiles
    WHERE role = 'company_owner'
    ORDER BY created_at ASC
    LIMIT 1;
    
    -- Split full_name into first_name and last_name
    IF user_full_name IS NOT NULL AND user_full_name != '' THEN
      first_name_part := COALESCE(SPLIT_PART(user_full_name, ' ', 1), 'Staff');
      -- Get everything after the first space as last name, or default to 'Member'
      IF POSITION(' ' IN user_full_name) > 0 THEN
        last_name_part := COALESCE(SUBSTRING(user_full_name FROM POSITION(' ' IN user_full_name) + 1), 'Member');
      ELSE
        last_name_part := 'Member';
      END IF;
    ELSE
      first_name_part := 'Staff';
      last_name_part := 'Member';
    END IF;
    
    -- Create staff_member record if we found a company owner
    IF company_owner_uuid IS NOT NULL THEN
      INSERT INTO public.staff_members (
        company_owner_id,
        user_id,
        first_name,
        last_name,
        email,
        role,
        status,
        created_at,
        updated_at
      )
      VALUES (
        company_owner_uuid,
        NEW.id,
        first_name_part,
        last_name_part,
        NEW.email,
        'Staff Member',
        'active',
        NOW(),
        NOW()
      )
      RETURNING id INTO staff_member_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create staff_member records for existing staff members who don't have one
DO $$
DECLARE
  staff_profile RECORD;
  company_owner_uuid UUID;
  first_name_part TEXT;
  last_name_part TEXT;
  existing_staff_member_id UUID;
BEGIN
  -- Find the first company owner to use as default
  SELECT id INTO company_owner_uuid
  FROM public.user_profiles
  WHERE role = 'company_owner'
  ORDER BY created_at ASC
  LIMIT 1;
  
  -- If we have a company owner, process existing staff members
  IF company_owner_uuid IS NOT NULL THEN
    FOR staff_profile IN 
      SELECT * FROM public.user_profiles 
      WHERE role = 'staff_member'
    LOOP
      -- Check if staff_member record already exists
      SELECT id INTO existing_staff_member_id
      FROM public.staff_members
      WHERE user_id = staff_profile.id
      LIMIT 1;
      
      -- Only create if it doesn't exist
      IF existing_staff_member_id IS NULL THEN
        -- Split full_name into first_name and last_name
        IF staff_profile.full_name IS NOT NULL AND staff_profile.full_name != '' THEN
          first_name_part := COALESCE(SPLIT_PART(staff_profile.full_name, ' ', 1), 'Staff');
          IF POSITION(' ' IN staff_profile.full_name) > 0 THEN
            last_name_part := COALESCE(SUBSTRING(staff_profile.full_name FROM POSITION(' ' IN staff_profile.full_name) + 1), 'Member');
          ELSE
            last_name_part := 'Member';
          END IF;
        ELSE
          first_name_part := 'Staff';
          last_name_part := 'Member';
        END IF;
        
        -- Create staff_member record
        INSERT INTO public.staff_members (
          company_owner_id,
          user_id,
          first_name,
          last_name,
          email,
          role,
          status,
          created_at,
          updated_at
        )
        VALUES (
          company_owner_uuid,
          staff_profile.id,
          first_name_part,
          last_name_part,
          staff_profile.email,
          'Staff Member',
          'active',
          NOW(),
          NOW()
        );
        
        RAISE NOTICE 'Created staff_member record for user % (%)', staff_profile.email, staff_profile.id;
      END IF;
    END LOOP;
  ELSE
    RAISE WARNING 'No company owner found. Cannot create staff_member records for existing staff members.';
  END IF;
END $$;


-- ========== 010_insert_client_relations.sql ==========
-- Migration: Insert Client States, Conversations, and Expert States
-- File: supabase/migrations/010_insert_client_relations.sql
-- This migration adds related data for the 7 demo clients


-- Insert client_states for the 7 clients
-- Each client gets 1-2 states assigned
INSERT INTO client_states (client_id, state)
SELECT 
  c.id,
  state_value
FROM clients c
CROSS JOIN (
  VALUES 
    ('ComfortCare Home Health Services', 'California'),
    ('ComfortCare Home Health Services', 'Texas'),
    ('Elite Senior Care Solutions', 'New York'),
    ('Harmony Home Healthcare', 'Florida'),
    ('Harmony Home Healthcare', 'California'),
    ('Premier Care Associates', 'Texas'),
    ('Apex Home Health Services', 'Illinois'),
    ('Wellness Home Care Group', 'Pennsylvania'),
    ('Wellness Home Care Group', 'Ohio'),
    ('Guardian Home Health LLC', 'Michigan')
) AS client_states_data(company_name, state_value)
WHERE c.company_name = client_states_data.company_name
ON CONFLICT (client_id, state) DO NOTHING;

-- Insert conversations for each client
-- Link conversations to the expert if available
DO $$
DECLARE
  client_record RECORD;
  expert_record_id UUID;
  days_ago INTEGER;
BEGIN
  -- Get the expert record ID
  SELECT id INTO expert_record_id
  FROM licensing_experts
  WHERE email = 'expert@demo.com' AND status = 'active'
  LIMIT 1;

  -- Create a conversation for each client
  FOR client_record IN 
    SELECT id, company_name
    FROM clients
    WHERE company_name IN (
      'ComfortCare Home Health Services',
      'Elite Senior Care Solutions',
      'Harmony Home Healthcare',
      'Premier Care Associates',
      'Apex Home Health Services',
      'Wellness Home Care Group',
      'Guardian Home Health LLC'
    )
    AND NOT EXISTS (
      SELECT 1 FROM conversations WHERE client_id = clients.id
    )
  LOOP
    -- Random days ago (0-30 days)
    days_ago := floor(random() * 31)::INTEGER;
    
    INSERT INTO conversations (client_id, expert_id, last_message_at)
    VALUES (
      client_record.id,
      expert_record_id,
      NOW() - (days_ago || ' days')::INTERVAL
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Insert expert_states for the expert
-- Assign the expert to multiple states they specialize in
INSERT INTO expert_states (expert_id, state)
SELECT 
  le.id,
  state_value
FROM licensing_experts le
CROSS JOIN (
  VALUES 
    ('California'),
    ('Texas'),
    ('New York'),
    ('Florida'),
    ('Illinois'),
    ('Pennsylvania'),
    ('Ohio')
) AS expert_states_data(state_value)
WHERE le.email = 'expert@demo.com'
  AND le.status = 'active'
ON CONFLICT (expert_id, state) DO NOTHING;

-- Update clients to assign expert_id where we have an expert
UPDATE clients c
SET expert_id = le.user_id
FROM licensing_experts le
WHERE le.email = 'expert@demo.com'
  AND le.status = 'active'
  AND c.company_name IN (
    'ComfortCare Home Health Services',
    'Elite Senior Care Solutions',
    'Harmony Home Healthcare',
    'Premier Care Associates',
    'Apex Home Health Services',
    'Wellness Home Care Group',
    'Guardian Home Health LLC'
  )
  AND c.expert_id IS NULL;

-- Summary
DO $$
DECLARE
  client_states_count INTEGER;
  conversations_count INTEGER;
  expert_states_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO client_states_count
  FROM client_states cs
  INNER JOIN clients c ON c.id = cs.client_id
  WHERE c.company_name IN (
    'ComfortCare Home Health Services',
    'Elite Senior Care Solutions',
    'Harmony Home Healthcare',
    'Premier Care Associates',
    'Apex Home Health Services',
    'Wellness Home Care Group',
    'Guardian Home Health LLC'
  );

  SELECT COUNT(*) INTO conversations_count
  FROM conversations conv
  INNER JOIN clients c ON c.id = conv.client_id
  WHERE c.company_name IN (
    'ComfortCare Home Health Services',
    'Elite Senior Care Solutions',
    'Harmony Home Healthcare',
    'Premier Care Associates',
    'Apex Home Health Services',
    'Wellness Home Care Group',
    'Guardian Home Health LLC'
  );

  SELECT COUNT(*) INTO expert_states_count
  FROM expert_states es
  INNER JOIN licensing_experts le ON le.id = es.expert_id
  WHERE le.email = 'expert@demo.com';

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration Summary:';
  RAISE NOTICE '  Client States: % records', client_states_count;
  RAISE NOTICE '  Conversations: % records', conversations_count;
  RAISE NOTICE '  Expert States: % records', expert_states_count;
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
END $$;

-- ========== 014_create_expert_function.sql ==========
-- Migration: Create function to add licensing experts
-- This function creates both the user account and licensing_expert record
-- Run this in Supabase SQL Editor

-- Enable pgcrypto extension if not already enabled
-- Note: This must be run as a superuser/database owner
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop function if exists to recreate it
DROP FUNCTION IF EXISTS create_licensing_expert(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_licensing_expert;

-- Create the function
CREATE OR REPLACE FUNCTION create_licensing_expert(
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_password TEXT,
  p_phone TEXT DEFAULT NULL,
  p_expertise TEXT DEFAULT NULL,
  p_role TEXT DEFAULT 'Licensing Specialist',
  p_status TEXT DEFAULT 'active'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgcrypto
AS $$
DECLARE
  v_user_id UUID;
  v_expert_id UUID;
  v_instance_uuid UUID;
  v_now_ts TIMESTAMPTZ;
  v_encrypted_pw TEXT;
BEGIN
  v_now_ts := NOW();
  
  -- Get instance UUID
  SELECT COALESCE(
    (SELECT instance_id FROM auth.users LIMIT 1),
    (SELECT id FROM auth.instances LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ) INTO v_instance_uuid;
  
  -- Check if user already exists
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(p_email))
  LIMIT 1;
  
  -- Create user if doesn't exist
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    -- Hash the password using bcrypt with cost 10
    -- pgcrypto is in search_path, so we can use gen_salt directly
    v_encrypted_pw := crypt(p_password, gen_salt('bf', 10));
    
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at, invited_at,
      confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at,
      email_change_token_new, email_change, email_change_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
      phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
      confirmed_at, email_change_token_current, email_change_confirm_status,
      banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user,
      deleted_at, aud, role
    ) VALUES (
      v_user_id, v_instance_uuid, LOWER(TRIM(p_email)), v_encrypted_pw, v_now_ts, NULL,
      '', NULL, '', NULL, '', '', NULL, NULL,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_first_name || ' ' || p_last_name, 'role', 'expert'),
      FALSE, v_now_ts, v_now_ts, p_phone, NULL, '', '', NULL,
      v_now_ts, '', 0, NULL, '', NULL, FALSE, NULL, 'authenticated', 'authenticated'
    );
    
    -- Create user profile
    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (v_user_id, LOWER(TRIM(p_email)), p_first_name || ' ' || p_last_name, 'expert')
    ON CONFLICT (id) DO UPDATE
    SET 
      full_name = EXCLUDED.full_name, 
      role = EXCLUDED.role,
      email = EXCLUDED.email,
      updated_at = v_now_ts;
  END IF;
  
  -- Create or update licensing_expert record
  INSERT INTO licensing_experts (user_id, first_name, last_name, email, phone, status, expertise, role)
  VALUES (
    v_user_id,
    p_first_name,
    p_last_name,
    LOWER(TRIM(p_email)),
    p_phone,
    p_status,
    p_expertise,
    p_role
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    status = EXCLUDED.status,
    expertise = EXCLUDED.expertise,
    role = EXCLUDED.role,
    updated_at = v_now_ts
  RETURNING id INTO v_expert_id;
  
  RETURN v_expert_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create licensing expert: %', SQLERRM;
END;
$$;

-- Grant execute permission to authenticated users (admins will be checked by RLS)
GRANT EXECUTE ON FUNCTION create_licensing_expert(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Verify the function was created
DO $$
BEGIN
  RAISE NOTICE 'Function create_licensing_expert created successfully';
END $$;

-- ========== 015_update_user_password_function.sql ==========
-- Create function to update user password
-- This function uses SECURITY DEFINER to bypass RLS and update passwords

CREATE OR REPLACE FUNCTION update_user_password(
  p_user_id UUID,
  p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgcrypto
AS $$
DECLARE
  v_encrypted_pw TEXT;
BEGIN
  -- Encrypt the new password
  v_encrypted_pw := crypt(p_new_password, gen_salt('bf', 10));
  
  -- Update password in auth.users table
  UPDATE auth.users
  SET 
    encrypted_password = v_encrypted_pw,
    updated_at = NOW()
  WHERE id = p_user_id;
  
  -- Check if update was successful
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to update password: %', SQLERRM;
END;
$$;

-- Grant execute permission to authenticated users (admins will be checked by RLS)
GRANT EXECUTE ON FUNCTION update_user_password(UUID, TEXT) TO authenticated;

-- Verify the function was created
DO $$
BEGIN
  RAISE NOTICE 'Function update_user_password created successfully';
END $$;

-- ========== 016_create_pricing_table.sql ==========
-- /supabase/migrations/016_create_pricing_table.sql
create extension if not exists "uuid-ossp";

create table if not exists pricing (
  id uuid primary key default uuid_generate_v4(),
  owner_admin_license numeric not null,
  staff_license numeric not null,
  created_at timestamp with time zone default now()
);
-- ========== 017_change_staff_members_to_clients_relation.sql ==========
-- Migration: Change staff_members.company_owner_id to reference clients.id instead of auth.users.id
-- This creates a direct relationship between staff_members and clients

-- Step 1: Add company_owner_id to clients table if it doesn't exist
-- This links clients to their company owner (user)
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS company_owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create index for clients.company_owner_id
CREATE INDEX IF NOT EXISTS idx_clients_company_owner ON clients(company_owner_id);

-- Step 2: Populate clients.company_owner_id based on email matching
-- Match clients to company owners via contact_email
UPDATE clients c
SET company_owner_id = up.id
FROM user_profiles up
WHERE LOWER(TRIM(c.contact_email)) = LOWER(TRIM(up.email))
  AND up.role = 'company_owner'
  AND c.company_owner_id IS NULL;

-- Step 3: Add temporary column to store client_id during migration
ALTER TABLE staff_members
ADD COLUMN IF NOT EXISTS client_id_temp UUID;

-- Step 4: Migrate data: Map staff_members.company_owner_id (user) to client_id
-- Find the client that matches the staff member's company owner
UPDATE staff_members sm
SET client_id_temp = c.id
FROM clients c
WHERE c.company_owner_id = sm.company_owner_id
  AND sm.client_id_temp IS NULL;

-- Step 5: Drop existing foreign key constraint on company_owner_id
-- First, drop dependent policies that reference company_owner_id
DROP POLICY IF EXISTS "Company owners can view own staff" ON staff_members;
DROP POLICY IF EXISTS "Company owners can insert own staff" ON staff_members;
DROP POLICY IF EXISTS "Company owners can update own staff" ON staff_members;
DROP POLICY IF EXISTS "Company owners can delete own staff" ON staff_members;

-- Drop the foreign key constraint (PostgreSQL doesn't have a direct DROP CONSTRAINT IF EXISTS)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'staff_members_company_owner_id_fkey'
    AND table_name = 'staff_members'
  ) THEN
    ALTER TABLE staff_members DROP CONSTRAINT staff_members_company_owner_id_fkey;
  END IF;
END $$;

-- Step 6: Update company_owner_id column to reference clients instead
-- Copy client_id_temp to company_owner_id
UPDATE staff_members
SET company_owner_id = client_id_temp
WHERE client_id_temp IS NOT NULL;

-- Step 7: Add new foreign key constraint to clients table
ALTER TABLE staff_members
ADD CONSTRAINT staff_members_company_owner_id_fkey 
FOREIGN KEY (company_owner_id) REFERENCES clients(id) ON DELETE CASCADE;

-- Step 8: Make company_owner_id NOT NULL (after data migration)
-- First, handle any staff_members that couldn't be matched to a client
-- Set them to NULL temporarily, then we can decide what to do with them
ALTER TABLE staff_members
ALTER COLUMN company_owner_id DROP NOT NULL;

-- Update unmatched staff_members to NULL (they'll need to be manually assigned)
UPDATE staff_members
SET company_owner_id = NULL
WHERE client_id_temp IS NULL;

-- Now make it NOT NULL again (this will fail if there are NULLs, so we handle unmatched records above)
-- Actually, let's keep it nullable for now to handle edge cases
-- ALTER TABLE staff_members ALTER COLUMN company_owner_id SET NOT NULL;

-- Step 9: Drop temporary column
ALTER TABLE staff_members DROP COLUMN IF EXISTS client_id_temp;

-- Step 10: Update RLS policies to use client relationship
-- These policies check if the user is the company owner of the client
CREATE POLICY "Company owners can view own staff"
  ON staff_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = staff_members.company_owner_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can insert own staff"
  ON staff_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = staff_members.company_owner_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can update own staff"
  ON staff_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = staff_members.company_owner_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can delete own staff"
  ON staff_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = staff_members.company_owner_id
      AND c.company_owner_id = auth.uid()
    )
  );

-- Company owners can insert staff members (explicit policy; same condition as "insert own staff")
DROP POLICY IF EXISTS "Company owners can insert staff members" ON staff_members;
CREATE POLICY "Company owners can insert staff members"
  ON staff_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = staff_members.company_owner_id
      AND c.company_owner_id = auth.uid()
    )
  );

-- Step 11: Update staff_licenses RLS policies to use new relationship
DROP POLICY IF EXISTS "Company owners can view own staff licenses" ON staff_licenses;
DROP POLICY IF EXISTS "Company owners can insert own staff licenses" ON staff_licenses;
DROP POLICY IF EXISTS "Company owners can update own staff licenses" ON staff_licenses;
DROP POLICY IF EXISTS "Company owners can delete own staff licenses" ON staff_licenses;

CREATE POLICY "Company owners can view own staff licenses"
  ON staff_licenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_members sm
      INNER JOIN clients c ON c.id = sm.company_owner_id
      WHERE sm.id = staff_licenses.staff_member_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can insert own staff licenses"
  ON staff_licenses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff_members sm
      INNER JOIN clients c ON c.id = sm.company_owner_id
      WHERE sm.id = staff_licenses.staff_member_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can update own staff licenses"
  ON staff_licenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM staff_members sm
      INNER JOIN clients c ON c.id = sm.company_owner_id
      WHERE sm.id = staff_licenses.staff_member_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can delete own staff licenses"
  ON staff_licenses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM staff_members sm
      INNER JOIN clients c ON c.id = sm.company_owner_id
      WHERE sm.id = staff_licenses.staff_member_id
      AND c.company_owner_id = auth.uid()
    )
  );

-- Step 12: Add comment to document the change
COMMENT ON COLUMN staff_members.company_owner_id IS 'References clients.id (the client/company this staff member belongs to). Changed from referencing auth.users.id in migration 017.';

COMMENT ON COLUMN clients.company_owner_id IS 'References auth.users.id (the company owner user who owns this client company).';

-- ========== 018_drop_billing_table.sql ==========
-- Migration: Drop billing table
-- The billing table is no longer needed as billing is now calculated dynamically
-- from staff_members, applications, license_types, and pricing tables

-- Step 1: Drop RLS policies for billing table
DROP POLICY IF EXISTS "Admins can view all billing" ON billing;
DROP POLICY IF EXISTS "Admins can manage billing" ON billing;

-- Step 2: Drop trigger for billing table
DROP TRIGGER IF EXISTS update_billing_updated_at ON billing;

-- Step 3: Drop indexes (they will be automatically dropped with the table, but being explicit)
DROP INDEX IF EXISTS idx_billing_client;
DROP INDEX IF EXISTS idx_billing_month;
DROP INDEX IF EXISTS idx_billing_status;

-- Step 4: Drop the billing table
-- This will also drop the foreign key constraint to clients table
DROP TABLE IF EXISTS billing CASCADE;

-- ========== 077_license_types_schema.sql ==========
-- Migration: Create license_types table
-- File: supabase/migrations/019_create_license_types.sql
-- Run before 020_add_service_fee_to_license_types.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS license_types (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  state TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  cost_min NUMERIC,
  cost_max NUMERIC,
  cost_display TEXT,
  processing_time_min INTEGER,
  processing_time_max INTEGER,
  processing_time_display TEXT,
  renewal_period_years INTEGER DEFAULT 1,
  renewal_period_display TEXT,
  icon_type TEXT,
  requirements JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_types_state ON license_types(state);
CREATE INDEX IF NOT EXISTS idx_license_types_name ON license_types(name);
CREATE INDEX IF NOT EXISTS idx_license_types_is_active ON license_types(is_active);

-- Trigger for updated_at
CREATE TRIGGER update_license_types_updated_at
  BEFORE UPDATE ON license_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS: admins manage; authenticated users can read (for dropdowns and application detail)
ALTER TABLE license_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage license types"
  ON license_types FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Authenticated users can read license types" ON license_types;
DROP POLICY IF EXISTS "Anyone can read active license types" ON license_types;
CREATE POLICY "Anyone can read active license types"
  ON license_types FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins can read all (including inactive) via "Admins can manage license types" above.
-- ========== applications.license_type_id (FK to license_types) ==========
ALTER TABLE applications ADD COLUMN IF NOT EXISTS license_type_id UUID REFERENCES license_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_applications_license_type ON applications(license_type_id) WHERE license_type_id IS NOT NULL;
-- ========== 020_add_service_fee_to_license_types.sql ==========
-- Migration: Add service_fee column to license_types table
-- File: supabase/migrations/020_add_service_fee_to_license_types.sql
-- This migration adds a service_fee column to store service fees separately from application fees

-- Add service_fee column if it doesn't exist
ALTER TABLE license_types
ADD COLUMN IF NOT EXISTS service_fee NUMERIC DEFAULT 0;

-- Add service_fee_display column for formatted display
ALTER TABLE license_types
ADD COLUMN IF NOT EXISTS service_fee_display TEXT;

-- Update existing records: calculate service fee as 10% of application fee if not set
UPDATE license_types
SET service_fee = COALESCE(
  service_fee,
  CASE 
    WHEN cost_min IS NOT NULL THEN cost_min * 0.1
    ELSE 0
  END
),
service_fee_display = COALESCE(
  service_fee_display,
  CASE 
    WHEN cost_min IS NOT NULL THEN '$' || ROUND(cost_min * 0.1)::TEXT
    ELSE '$0'
  END
)
WHERE service_fee IS NULL OR service_fee = 0;

-- ========== 021_add_client_messages_rls.sql ==========
-- Migration: Add Client RLS Policies for Messages
-- File: supabase/migrations/021_add_client_messages_rls.sql
-- This migration adds RLS policies to allow clients (company owners) to view and send messages

-- RLS Policies for conversations (clients can view their own conversations)
DROP POLICY IF EXISTS "Clients can view own conversations" ON conversations;
CREATE POLICY "Clients can view own conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- RLS Policies for conversations (clients can create conversations)
DROP POLICY IF EXISTS "Clients can create conversations" ON conversations;
CREATE POLICY "Clients can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- RLS Policies for conversations (clients can update their conversations)
DROP POLICY IF EXISTS "Clients can update own conversations" ON conversations;
CREATE POLICY "Clients can update own conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- RLS Policies for messages (clients can view messages in their conversations)
DROP POLICY IF EXISTS "Clients can view own messages" ON messages;
CREATE POLICY "Clients can view own messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      JOIN clients ON clients.id = conversations.client_id
      WHERE conversations.id = messages.conversation_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- RLS Policies for messages (clients can send messages)
DROP POLICY IF EXISTS "Clients can insert messages" ON messages;
CREATE POLICY "Clients can insert messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      JOIN clients ON clients.id = conversations.client_id
      WHERE conversations.id = messages.conversation_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- RLS Policies for messages (clients can update their own messages)
DROP POLICY IF EXISTS "Clients can update own messages" ON messages;
CREATE POLICY "Clients can update own messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND sender_id = auth.uid()
  );

-- ========== 022_add_client_rls_for_company_owners.sql ==========
-- Migration: Add Client RLS Policies for Company Owners
-- File: supabase/migrations/022_add_client_rls_for_company_owners.sql
-- This migration adds RLS policies to allow company owners to view their own client record

-- RLS Policies for clients (company owners can view their own client record)
DROP POLICY IF EXISTS "Company owners can view own client" ON clients;
CREATE POLICY "Company owners can view own client"
  ON clients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND company_owner_id = auth.uid()
  );

-- ========== conversations.admin_id (003 creates table without it; 025 needs it) ==========
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_admin ON conversations(admin_id);

-- ========== 025_restore_conversations_table.sql ==========
-- Migration: Restore conversations table
-- File: supabase/migrations/025_restore_conversations_table.sql
-- This migration restores the conversations table to its original state after accidental deletion

-- Create conversations table (for messaging system)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  expert_id UUID REFERENCES licensing_experts(id) ON DELETE SET NULL,
  admin_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_expert ON conversations(expert_id);
CREATE INDEX IF NOT EXISTS idx_conversations_admin ON conversations(admin_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

-- Enable Row Level Security
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Add trigger for updated_at (drop first; 003 may have already created it)
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update conversation last_message_at when a message is created
-- (This function should already exist, but we'll ensure it does)
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at,
      updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_conversation_last_message_trigger ON messages;
CREATE TRIGGER update_conversation_last_message_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message();

-- Drop 025 conversation policies if they exist (005/003 may have created some; make idempotent)
DROP POLICY IF EXISTS "Admins can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Admins can manage own conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can create conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can update own conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can create conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can update own conversations" ON conversations;

-- RLS Policies for conversations (admins can view and manage their own conversations)
CREATE POLICY "Admins can view own conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
      AND conversations.admin_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage own conversations"
  ON conversations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
      AND conversations.admin_id = auth.uid()
    )
  );

-- RLS Policies for conversations (experts can view conversations with their clients)
CREATE POLICY "Experts can view own conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
  );

CREATE POLICY "Experts can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.expert_id = auth.uid()
    )
  );

CREATE POLICY "Experts can update own conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
  );

-- RLS Policies for conversations (clients can view their own conversations)
CREATE POLICY "Clients can view own conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Clients can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Clients can update own conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- ========== 029_drop_conversations_and_messages_tables.sql ==========
-- Migration: Drop Conversations and Messages Tables
-- File: supabase/migrations/029_drop_conversations_and_messages_tables.sql
-- This migration drops the messages and conversations tables and all related objects

-- Drop triggers first
DROP TRIGGER IF EXISTS update_conversation_last_message_trigger ON messages;
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;

-- Drop functions that are only used by these tables
DROP FUNCTION IF EXISTS update_conversation_last_message() CASCADE;

-- Drop all RLS policies on messages table
DROP POLICY IF EXISTS "Admins and experts can view messages" ON messages;
DROP POLICY IF EXISTS "Admins and experts can manage messages" ON messages;
DROP POLICY IF EXISTS "Experts can view own messages" ON messages;
DROP POLICY IF EXISTS "Experts can insert messages" ON messages;
DROP POLICY IF EXISTS "Experts can update own messages" ON messages;
DROP POLICY IF EXISTS "Clients can view own messages" ON messages;
DROP POLICY IF EXISTS "Clients can insert messages" ON messages;
DROP POLICY IF EXISTS "Clients can update own messages" ON messages;

-- Drop all RLS policies on conversations table
DROP POLICY IF EXISTS "Admins can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Admins can manage own conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can create conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can update own conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can create conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can update own conversations" ON conversations;

-- Drop messages table first (it has foreign key to conversations)
DROP TABLE IF EXISTS messages CASCADE;

-- Drop conversations table
DROP TABLE IF EXISTS conversations CASCADE;

-- ========== 030_create_1to1_messaging_system.sql ==========
-- Migration: Create 1:1 Real-time Messaging System
-- File: supabase/migrations/030_create_1to1_messaging_system.sql
-- This migration creates tables for 1:1 real-time chatting between admin, client, and expert

-- Create conversations table for 1:1 messaging
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  expert_id UUID REFERENCES licensing_experts(id) ON DELETE SET NULL,
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  -- Ensure only one of expert_id or admin_id is set (1:1 conversation)
  CONSTRAINT conversations_expert_or_admin_check 
    CHECK ((expert_id IS NULL AND admin_id IS NOT NULL) OR (expert_id IS NOT NULL AND admin_id IS NULL)),
  -- Ensure unique conversation per client-expert or client-admin pair
  CONSTRAINT conversations_unique_pair UNIQUE (client_id, expert_id, admin_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_expert ON conversations(expert_id);
CREATE INDEX IF NOT EXISTS idx_conversations_admin ON conversations(admin_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_read ON messages(conversation_id, is_read);

-- Add trigger for updated_at on conversations
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update conversation last_message_at when a message is created
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at,
      updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_message_at when message is inserted
CREATE TRIGGER update_conversation_last_message_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message();

-- Enable Row Level Security
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES FOR CONVERSATIONS
-- ============================================

-- Admins can view all conversations
CREATE POLICY "Admins can view all conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- Admins can create conversations with any client
CREATE POLICY "Admins can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
    AND admin_id = auth.uid()
  );

-- Admins can update conversations they're part of
CREATE POLICY "Admins can update conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
    AND admin_id = auth.uid()
  );

-- Experts can view conversations with their assigned clients
CREATE POLICY "Experts can view own conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.expert_id = auth.uid()
    )
  );

-- Experts can create conversations with their assigned clients
CREATE POLICY "Experts can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.expert_id = auth.uid()
    )
  );

-- Experts can update their own conversations
CREATE POLICY "Experts can update conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM licensing_experts
      WHERE licensing_experts.user_id = auth.uid()
      AND licensing_experts.id = conversations.expert_id
    )
  );

-- Clients (company owners) can view their own conversations
CREATE POLICY "Clients can view own conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- Clients can create conversations with admin or their assigned expert
CREATE POLICY "Clients can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
    AND (
      -- Can create with admin
      (conversations.admin_id IS NOT NULL)
      OR
      -- Can create with assigned expert
      (
        conversations.expert_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM clients c
          WHERE c.id = conversations.client_id
          AND c.expert_id IN (
            SELECT user_id FROM licensing_experts
            WHERE id = conversations.expert_id
          )
        )
      )
    )
  );

-- Clients can update their own conversations
CREATE POLICY "Clients can update conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = conversations.client_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- ============================================
-- RLS POLICIES FOR MESSAGES
-- ============================================

-- Admins can view messages in all conversations
CREATE POLICY "Admins can view all messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.admin_id = auth.uid()
    )
  );

-- Admins can send messages in their conversations
CREATE POLICY "Admins can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.admin_id = auth.uid()
    )
  );

-- Admins can update messages (mark as read)
CREATE POLICY "Admins can update messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.admin_id = auth.uid()
    )
  );

-- Experts can view messages in conversations with their clients
CREATE POLICY "Experts can view own messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.expert_id IN (
        SELECT id FROM licensing_experts
        WHERE user_id = auth.uid()
      )
    )
  );

-- Experts can send messages in their conversations
CREATE POLICY "Experts can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.expert_id IN (
        SELECT id FROM licensing_experts
        WHERE user_id = auth.uid()
      )
    )
  );

-- Experts can update messages (mark as read)
CREATE POLICY "Experts can update messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.expert_id IN (
        SELECT id FROM licensing_experts
        WHERE user_id = auth.uid()
      )
    )
  );

-- Clients can view messages in their conversations
CREATE POLICY "Clients can view own messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN clients ON clients.id = conversations.client_id
      WHERE conversations.id = messages.conversation_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- Clients can send messages in their conversations
CREATE POLICY "Clients can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN clients ON clients.id = conversations.client_id
      WHERE conversations.id = messages.conversation_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- Clients can update messages (mark as read)
CREATE POLICY "Clients can update messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN clients ON clients.id = conversations.client_id
      WHERE conversations.id = messages.conversation_id
      AND clients.company_owner_id = auth.uid()
    )
  );

-- Enable Realtime for messages table (for real-time updates)
-- Note: This requires Supabase Realtime to be enabled in the dashboard
-- The table will automatically be available for realtime subscriptions

COMMENT ON TABLE conversations IS '1:1 conversations between clients and admins or experts';
COMMENT ON TABLE messages IS 'Messages in 1:1 conversations with real-time support';

-- ========== 031_insert_sample_conversations_and_messages.sql ==========
-- Migration: Insert Sample Conversations and Messages
-- File: supabase/migrations/031_insert_sample_conversations_and_messages.sql
-- This migration creates sample conversations and messages for testing the messaging system
-- Sample conversations/messages skipped in production (no demo users).
DO $$ BEGIN NULL; END $$;


-- ========== 032_add_pricing_rls_policies.sql ==========
-- Migration: Add RLS policies for pricing table
-- This allows admins to view and manage pricing records

-- Enable Row Level Security on pricing table (if not already enabled)
ALTER TABLE pricing ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Admins can view pricing" ON pricing;
DROP POLICY IF EXISTS "Admins can insert pricing" ON pricing;
DROP POLICY IF EXISTS "Admins can update pricing" ON pricing;

-- RLS Policy: Admins can view pricing
CREATE POLICY "Admins can view pricing"
  ON pricing FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policy: Admins can insert pricing
CREATE POLICY "Admins can insert pricing"
  ON pricing FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policy: Admins can update pricing
CREATE POLICY "Admins can update pricing"
  ON pricing FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- ========== 033_fix_handle_new_user_for_staff_members.sql ==========
-- Migration: Fix handle_new_user trigger to not create staff_member records
-- After migration 017, staff_members.company_owner_id references clients.id, not user_profiles.id
-- Since staff members are created manually through the admin form, we should not auto-create them in the trigger

-- Update the handle_new_user function to only create user_profiles, not staff_member records
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
  user_full_name TEXT;
BEGIN
  -- Get role and full_name from metadata
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'staff_member');
  user_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  
  -- Create user profile only
  -- Staff member records should be created manually through the admin form
  -- to ensure proper client relationship
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    user_full_name,
    user_role
  )
  ON CONFLICT (id) DO UPDATE
  SET 
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========== 034_fix_staff_members_policy.sql ==========
-- Migration: Fix staff_members RLS policy for staff members to view their own record
-- This ensures staff members can view their own record even after migration 017

-- Ensure the policy exists (it should from migration 004, but let's make sure)
DROP POLICY IF EXISTS "Staff members can view own record" ON staff_members;
CREATE POLICY "Staff members can view own record"
  ON staff_members FOR SELECT
  USING (user_id = auth.uid());

  DROP POLICY IF EXISTS "Company owner can view own record" ON staff_members;
CREATE POLICY "Company owner can view own record"
  ON staff_members FOR SELECT
  USING (company_owner_id = auth.uid());
-- ========== 035_modify_applications_for_staff_licenses.sql ==========
-- Modify applications table to support staff member licenses
-- Instead of using a separate staff_licenses table, we'll use applications for both
-- company owner applications and staff member licenses

-- Step 1: Make company_owner_id nullable to support staff member licenses
-- First, we need to drop the NOT NULL constraint
ALTER TABLE applications
ALTER COLUMN company_owner_id DROP NOT NULL;

-- Step 2: Add staff_member_id column to applications (nullable, so existing applications still work)
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS staff_member_id UUID REFERENCES staff_members(id) ON DELETE CASCADE;

-- Step 3: Add license-specific columns to applications
ALTER TABLE applications
ADD COLUMN IF NOT EXISTS license_number TEXT,
ADD COLUMN IF NOT EXISTS issue_date DATE,
ADD COLUMN IF NOT EXISTS expiry_date DATE,
ADD COLUMN IF NOT EXISTS days_until_expiry INTEGER,
ADD COLUMN IF NOT EXISTS issuing_authority TEXT;

-- Step 4: Create index for staff_member_id
CREATE INDEX IF NOT EXISTS idx_applications_staff_member ON applications(staff_member_id);

-- Step 5: Create index for expiry_date (useful for staff licenses)
CREATE INDEX IF NOT EXISTS idx_applications_expiry_date ON applications(expiry_date);

-- Step 6: Add check constraint to ensure either company_owner_id or staff_member_id is set
ALTER TABLE applications
ADD CONSTRAINT applications_owner_or_staff_check 
CHECK (
  (company_owner_id IS NOT NULL AND staff_member_id IS NULL) OR
  (company_owner_id IS NULL AND staff_member_id IS NOT NULL)
);

-- Step 7: Update RLS policies to allow staff members to view their own applications/licenses
-- Drop existing staff member policy if it exists
DROP POLICY IF EXISTS "Staff members can view own applications" ON applications;
DROP POLICY IF EXISTS "Staff members can insert own applications" ON applications;
DROP POLICY IF EXISTS "Staff members can update own applications" ON applications;
DROP POLICY IF EXISTS "Staff members can delete own applications" ON applications;

-- Create RLS policies for staff members
CREATE POLICY "Staff members can view own applications"
  ON applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_members 
      WHERE staff_members.id = applications.staff_member_id 
      AND staff_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Staff members can insert own applications"
  ON applications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff_members 
      WHERE staff_members.id = applications.staff_member_id 
      AND staff_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Staff members can update own applications"
  ON applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM staff_members 
      WHERE staff_members.id = applications.staff_member_id 
      AND staff_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Staff members can delete own applications"
  ON applications FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM staff_members 
      WHERE staff_members.id = applications.staff_member_id 
      AND staff_members.user_id = auth.uid()
    )
  );

-- Admins and experts: application policies
DROP POLICY IF EXISTS "Admins can view all applications" ON applications;
CREATE POLICY "Admins can view all applications"
  ON applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update all applications" ON applications;
CREATE POLICY "Admins can update all applications"
  ON applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Experts can view assigned applications" ON applications;
CREATE POLICY "Experts can view assigned applications"
  ON applications FOR SELECT
  USING (assigned_expert_id = auth.uid());

DROP POLICY IF EXISTS "Experts can update assigned applications" ON applications;
CREATE POLICY "Experts can update assigned applications"
  ON applications FOR UPDATE
  USING (assigned_expert_id = auth.uid());

-- Step 8: Create or replace function to update days_until_expiry for applications
CREATE OR REPLACE FUNCTION update_application_expiry_days()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expiry_date IS NOT NULL THEN
    NEW.days_until_expiry = NEW.expiry_date - CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Create trigger to automatically update days_until_expiry
DROP TRIGGER IF EXISTS update_application_expiry_days_trigger ON applications;
CREATE TRIGGER update_application_expiry_days_trigger
  BEFORE INSERT OR UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION update_application_expiry_days();

-- Step 10: Update existing company owner policies to handle nullable company_owner_id
-- The existing policies should still work, but we need to ensure they only apply when company_owner_id is not null
-- The existing policies from migration 002 should handle this correctly since they check auth.uid() = company_owner_id
-- which will be false when company_owner_id is NULL

-- ========== 078_certification_types_schema.sql ==========
-- Create certification_types table
CREATE TABLE IF NOT EXISTS certification_types (
  id SERIAL PRIMARY KEY,
  certification_type VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Seed data (only if you're creating the table fresh; remove or skip if table already has rows)
INSERT INTO certification_types (certification_type) VALUES
  ('CPR Certification'),
  ('First Aid Certification'),
  ('Home Health Aide Certification'),
  ('Registered Nurse License'),
  ('Medication Administration Certification'),
  ('Background Check Clearance'),
  ('TB Test Clearance');

-- RLS
ALTER TABLE certification_types ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read (039 will replace "staff only" with this if you run 039 later)
CREATE POLICY "Allow staff to read certification types"
ON certification_types
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE auth.uid() = user_profiles.id
    AND user_profiles.role = 'staff_member'
  )
);
-- ========== 036_add_certifications.sql (no cert types insert) ==========
-- Enable UUID generation (run once per project)
create extension if not exists "uuid-ossp";

-- Create certifications table
create table public.certifications (
  id uuid primary key default uuid_generate_v4(),

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  type text not null,
  license_number text not null,
  state text,

  issue_date date,
  expiration_date date not null,

  issuing_authority text not null,

  status text not null default 'Active',

  document_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);





CREATE POLICY "User can manage own certifications"
ON certifications
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Company owners can read certifications for their staff
DROP POLICY IF EXISTS "Company owners can read certifications" ON certifications;
CREATE POLICY "Company owners can read certifications"
  ON certifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_members
      WHERE staff_members.user_id = certifications.user_id
      AND staff_members.company_owner_id = auth.uid()
    )
  );

-- Certification types seeded in 078_certification_types_schema.sql
-- ========== 036_add_sample_staff_licenses.sql ==========
-- Migration: Add 4 sample license records to applications table for staff members
-- This migration inserts 4 sample licenses/certifications for existing staff members

DO $$
DECLARE
  staff_member_rec RECORD;
  staff_members_array UUID[];
  license_types TEXT[] := ARRAY[
    'Registered Nurse (RN)',
    'Basic Life Support (BLS)',
    'Certified Home Health Aide (CHHA)',
    'Licensed Practical Nurse (LPN)'
  ];
  license_numbers TEXT[] := ARRAY[
    'RN-2021-12345',
    'BLS-2021-67890',
    'CHHA-TX-2021-001',
    'LPN-CA-2022-456'
  ];
  states TEXT[] := ARRAY[
    'Texas',
    'California',
    'Texas',
    'California'
  ];
  issuing_authorities TEXT[] := ARRAY[
    'Texas Board of Nursing',
    'American Heart Association',
    'Texas Health and Human Services',
    'California Board of Vocational Nursing'
  ];
  issue_dates DATE[] := ARRAY[
    '2022-03-14'::DATE,
    '2024-01-09'::DATE,
    '2021-01-19'::DATE,
    '2022-06-15'::DATE
  ];
  expiry_dates DATE[] := ARRAY[
    '2026-03-14'::DATE,
    '2026-04-19'::DATE,
    '2026-07-29'::DATE,
    '2026-02-25'::DATE
  ];
  staff_counter INTEGER := 0;
  i INTEGER;
  today_date DATE := CURRENT_DATE;
BEGIN
  -- Get first 4 active staff members
  SELECT ARRAY_AGG(id ORDER BY created_at ASC)
  INTO staff_members_array
  FROM staff_members
  WHERE status = 'active'
  LIMIT 4;

  -- Check if we have enough staff members
  IF staff_members_array IS NULL OR array_length(staff_members_array, 1) < 4 THEN
    RAISE NOTICE 'Warning: Found fewer than 4 active staff members. Creating licenses for available staff.';
  END IF;

  -- Insert 4 license records
  FOR i IN 1..LEAST(4, COALESCE(array_length(staff_members_array, 1), 0)) LOOP
    -- Calculate days until expiry
    DECLARE
      days_until_expiry_val INTEGER;
      started_date_val DATE;
      last_updated_date_val DATE;
      submitted_date_val DATE;
    BEGIN
      days_until_expiry_val := expiry_dates[i] - today_date;
      started_date_val := issue_dates[i];
      last_updated_date_val := today_date;
      submitted_date_val := issue_dates[i];

      -- Insert application record (representing a staff license)
      INSERT INTO applications (
        staff_member_id,
        company_owner_id,  -- NULL for staff licenses
        application_name,  -- This is the license type
        license_number,
        state,
        status,  -- 'approved' means active license
        progress_percentage,
        started_date,
        last_updated_date,
        submitted_date,
        issue_date,
        expiry_date,
        days_until_expiry,
        issuing_authority,
        created_at,
        updated_at
      )
      VALUES (
        staff_members_array[i],
        NULL,  -- Staff licenses don't have company_owner_id
        license_types[i],
        license_numbers[i],
        states[i],
        'approved',  -- Status: approved = active license
        100,  -- Progress: 100% for completed licenses
        started_date_val,
        last_updated_date_val,
        submitted_date_val,
        issue_dates[i],
        expiry_dates[i],
        days_until_expiry_val,  -- Will be recalculated by trigger, but set initial value
        issuing_authorities[i],
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING;

      -- Get staff member name for logging
      SELECT first_name, last_name
      INTO staff_member_rec
      FROM staff_members
      WHERE id = staff_members_array[i];

      IF FOUND THEN
        staff_counter := staff_counter + 1;
        RAISE NOTICE 'âœ“ Created license "%" for staff member % % (ID: %)',
          license_types[i],
          staff_member_rec.first_name,
          staff_member_rec.last_name,
          staff_members_array[i];
      END IF;
    END;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Created %/4 staff license records in applications table', staff_counter;
  RAISE NOTICE '========================================';
  RAISE NOTICE '';

  -- Show summary of created licenses
  RAISE NOTICE 'License Summary:';
  FOR staff_member_rec IN
    SELECT 
      sm.id,
      sm.first_name,
      sm.last_name,
      COUNT(a.id) as license_count
    FROM staff_members sm
    LEFT JOIN applications a ON a.staff_member_id = sm.id AND a.staff_member_id IS NOT NULL
    WHERE sm.id = ANY(staff_members_array)
    GROUP BY sm.id, sm.first_name, sm.last_name
    ORDER BY sm.first_name, sm.last_name
  LOOP
    RAISE NOTICE '  % %: % license(s)',
      staff_member_rec.first_name,
      staff_member_rec.last_name,
      staff_member_rec.license_count;
  END LOOP;

END $$;

-- ========== 037_certification_types_schema.sql (policy only, table in 078) ==========
DROP POLICY IF EXISTS "Allow staff to read certification types" ON certification_types;
CREATE POLICY "Allow staff to read certification types"
ON certification_types
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE auth.uid() = user_profiles.id
    AND user_profiles.role = 'staff_member'
  )
);
-- ========== 038_add_pricing_history.sql ==========
-- Migration: Add pricing history support
-- This allows tracking pricing changes over time and maintaining billing history

-- Add effective_date column to pricing table
ALTER TABLE pricing 
ADD COLUMN IF NOT EXISTS effective_date DATE DEFAULT CURRENT_DATE;

-- Add index for efficient date-based queries
CREATE INDEX IF NOT EXISTS idx_pricing_effective_date ON pricing(effective_date);

-- Update existing pricing records to have effective_date = created_at date
UPDATE pricing 
SET effective_date = DATE(created_at)
WHERE effective_date IS NULL;

-- Make effective_date NOT NULL after setting defaults
ALTER TABLE pricing 
ALTER COLUMN effective_date SET NOT NULL;

-- Add comment explaining the purpose
COMMENT ON COLUMN pricing.effective_date IS 'The date from which this pricing becomes effective. Used to maintain billing history when pricing changes.';

-- ========== 039_create_system_lists_tables.sql ==========
-- Create issuing_authorities table
CREATE TABLE IF NOT EXISTS issuing_authorities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create staff_roles table
CREATE TABLE IF NOT EXISTS staff_roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE issuing_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;

-- Allow admins to manage issuing_authorities
CREATE POLICY "Admins can manage issuing_authorities"
ON issuing_authorities
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE auth.uid() = user_profiles.id
    AND user_profiles.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE auth.uid() = user_profiles.id
    AND user_profiles.role = 'admin'
  )
);

-- Allow authenticated users to read issuing_authorities
CREATE POLICY "Authenticated users can read issuing_authorities"
ON issuing_authorities
FOR SELECT
TO authenticated
USING (true);

-- Allow admins to manage staff_roles
CREATE POLICY "Admins can manage staff_roles"
ON staff_roles
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE auth.uid() = user_profiles.id
    AND user_profiles.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE auth.uid() = user_profiles.id
    AND user_profiles.role = 'admin'
  )
);

-- Allow authenticated users to read staff_roles
CREATE POLICY "Authenticated users can read staff_roles"
ON staff_roles
FOR SELECT
TO authenticated
USING (true);

-- Update certification_types RLS to allow admins to manage
DROP POLICY IF EXISTS "Allow staff to read certification types" ON certification_types;

CREATE POLICY "Authenticated users can read certification types"
ON certification_types
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage certification types"
ON certification_types
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE auth.uid() = user_profiles.id
    AND user_profiles.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE auth.uid() = user_profiles.id
    AND user_profiles.role = 'admin'
  )
);

-- ========== 041_allow_clients_read_assigned_expert.sql ==========
-- Migration: Allow Clients to Read Their Assigned Expert Records
-- File: supabase/migrations/041_allow_clients_read_assigned_expert.sql
-- This migration allows company owners to read licensing_experts records for experts assigned to their applications

-- Allow clients (company owners) to view expert records for experts assigned to their applications
CREATE POLICY "Clients can view assigned expert records"
  ON licensing_experts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.company_owner_id = auth.uid()
      AND applications.assigned_expert_id = licensing_experts.user_id
    )
  );

-- Company owners can manage (view and update) experts assigned to their applications
DROP POLICY IF EXISTS "Company owners can manage experts" ON licensing_experts;
CREATE POLICY "Company owners can manage experts"
  ON licensing_experts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.company_owner_id = auth.uid()
      AND applications.assigned_expert_id = licensing_experts.user_id
    )
  );

DROP POLICY IF EXISTS "Company owners can update assigned experts" ON licensing_experts;
CREATE POLICY "Company owners can update assigned experts"
  ON licensing_experts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.company_owner_id = auth.uid()
      AND applications.assigned_expert_id = licensing_experts.user_id
    )
  );

-- ========== 042_convert_to_application_group_chat.sql ==========
-- Migration: Convert conversations to application-based group chat
-- File: supabase/migrations/042_convert_to_application_group_chat.sql
-- This migration converts the 1:1 messaging system to group chat per application

-- Step 1: Add application_id column to conversations table
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS application_id UUID REFERENCES applications(id) ON DELETE CASCADE;

-- Step 2: Create index for application_id
CREATE INDEX IF NOT EXISTS idx_conversations_application ON conversations(application_id);

-- Step 3: Drop the old constraint that only allows one of expert_id or admin_id
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS conversations_expert_or_admin_check;

-- Step 4: Drop the old unique constraint
ALTER TABLE conversations 
DROP CONSTRAINT IF EXISTS conversations_unique_pair;

-- Step 5: Add new unique constraint for application-based conversations
-- One conversation per application
ALTER TABLE conversations 
ADD CONSTRAINT conversations_unique_application UNIQUE (application_id);

-- Step 6: Update RLS policies for group chat access based on application

-- Drop old conversation policies
DROP POLICY IF EXISTS "Admins can view all conversations" ON conversations;
DROP POLICY IF EXISTS "Admins can create conversations" ON conversations;
DROP POLICY IF EXISTS "Admins can update conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can create conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can update conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can create conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can update conversations" ON conversations;

-- New RLS policies for application-based group chat

-- Admins can view conversations for any application
CREATE POLICY "Admins can view application conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- Admins can create conversations for any application
CREATE POLICY "Admins can create application conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- Admins can update conversations for any application
CREATE POLICY "Admins can update application conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- Experts can view conversations for applications they're assigned to
CREATE POLICY "Experts can view assigned application conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = conversations.application_id
      AND applications.assigned_expert_id = auth.uid()
    )
  );

-- Experts can create conversations for applications they're assigned to
CREATE POLICY "Experts can create assigned application conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = conversations.application_id
      AND applications.assigned_expert_id = auth.uid()
    )
  );

-- Experts can update conversations for applications they're assigned to
CREATE POLICY "Experts can update assigned application conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = conversations.application_id
      AND applications.assigned_expert_id = auth.uid()
    )
  );

-- Company owners can view conversations for their own applications
CREATE POLICY "Company owners can view own application conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = conversations.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

-- Company owners can create conversations for their own applications
CREATE POLICY "Company owners can create own application conversations"
  ON conversations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = conversations.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

-- Company owners can update conversations for their own applications
CREATE POLICY "Company owners can update own application conversations"
  ON conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = conversations.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

-- Step 7: Update message RLS policies for group chat

-- Drop old message policies
DROP POLICY IF EXISTS "Admins can view all messages" ON messages;
DROP POLICY IF EXISTS "Admins can send messages" ON messages;
DROP POLICY IF EXISTS "Admins can update messages" ON messages;
DROP POLICY IF EXISTS "Experts can view own messages" ON messages;
DROP POLICY IF EXISTS "Experts can send messages" ON messages;
DROP POLICY IF EXISTS "Experts can update messages" ON messages;
DROP POLICY IF EXISTS "Clients can view own messages" ON messages;
DROP POLICY IF EXISTS "Clients can send messages" ON messages;
DROP POLICY IF EXISTS "Clients can update messages" ON messages;

-- New message policies for application-based group chat

-- Admins can view messages in any application conversation
CREATE POLICY "Admins can view application messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
    )
  );

-- Admins can send messages in any application conversation
CREATE POLICY "Admins can send application messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
    )
  );

-- Admins can update messages (mark as read) in any application conversation
CREATE POLICY "Admins can update application messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
    )
  );

-- Experts can view messages in conversations for applications they're assigned to
CREATE POLICY "Experts can view assigned application messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN applications ON applications.id = conversations.application_id
      WHERE conversations.id = messages.conversation_id
      AND applications.assigned_expert_id = auth.uid()
    )
  );

-- Experts can send messages in conversations for applications they're assigned to
CREATE POLICY "Experts can send assigned application messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN applications ON applications.id = conversations.application_id
      WHERE conversations.id = messages.conversation_id
      AND applications.assigned_expert_id = auth.uid()
    )
  );

-- Experts can update messages (mark as read) in conversations for applications they're assigned to
CREATE POLICY "Experts can update assigned application messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'expert'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN applications ON applications.id = conversations.application_id
      WHERE conversations.id = messages.conversation_id
      AND applications.assigned_expert_id = auth.uid()
    )
  );

-- Company owners can view messages in conversations for their own applications
CREATE POLICY "Company owners can view own application messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN applications ON applications.id = conversations.application_id
      WHERE conversations.id = messages.conversation_id
      AND applications.company_owner_id = auth.uid()
    )
  );

-- Company owners can send messages in conversations for their own applications
CREATE POLICY "Company owners can send own application messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN applications ON applications.id = conversations.application_id
      WHERE conversations.id = messages.conversation_id
      AND applications.company_owner_id = auth.uid()
    )
  );

-- Company owners can update messages (mark as read) in conversations for their own applications
CREATE POLICY "Company owners can update own application messages"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'company_owner'
    )
    AND EXISTS (
      SELECT 1 FROM conversations
      INNER JOIN applications ON applications.id = conversations.application_id
      WHERE conversations.id = messages.conversation_id
      AND applications.company_owner_id = auth.uid()
    )
  );

COMMENT ON TABLE conversations IS 'Group chat conversations per application (admin, company owner, and expert can all participate)';

-- ========== 043_notifications_table.sql ==========
-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('license_expiring', 'license_expired', 'application_update', 'document_approved', 'document_rejected', 'staff_certification_expiring', 'general')) DEFAULT 'general',
  icon_type TEXT CHECK (icon_type IN ('exclamation', 'document', 'bell', 'check', 'warning')),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- Enable Row Level Security
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop 043 notifications policies if they exist (002 may have already created them; make idempotent)
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;

-- RLS Policies for notifications
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notifications"
  ON notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can insert notifications for any user
DROP POLICY IF EXISTS "Admins can insert notifications for any user" ON notifications;
CREATE POLICY "Admins can insert notifications for any user"
  ON notifications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Experts can insert notifications (e.g. for assigned clients)
DROP POLICY IF EXISTS "Experts can insert notifications" ON notifications;
CREATE POLICY "Experts can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'expert'
    )
  );

-- ========== 044_optimize_message_notifications.sql ==========
-- Migration: Add optimized indexes for message notifications
-- File: supabase/migrations/044_optimize_message_notifications.sql
-- This migration adds composite indexes to optimize notification queries

-- Composite index for efficient unread message counting
-- This index helps with queries filtering by conversation_id, is_read, and sender_id
CREATE INDEX IF NOT EXISTS idx_messages_conversation_read_sender 
ON messages(conversation_id, is_read, sender_id) 
WHERE is_read = false;

-- Composite index for application-based queries
-- Helps with filtering applications by owner or expert
CREATE INDEX IF NOT EXISTS idx_applications_owner_expert 
ON applications(company_owner_id, assigned_expert_id) 
WHERE company_owner_id IS NOT NULL OR assigned_expert_id IS NOT NULL;

-- Index for user_profiles role lookups (if not exists)
-- Helps with quick role-based filtering
CREATE INDEX IF NOT EXISTS idx_user_profiles_role 
ON user_profiles(role) 
WHERE role IN ('admin', 'company_owner', 'expert');

-- Additional index for messages with conversation_id and is_read
-- This is a partial index that only indexes unread messages
CREATE INDEX IF NOT EXISTS idx_messages_unread_conversation 
ON messages(conversation_id) 
WHERE is_read = false;

-- Index for applications with company_owner_id (if not exists)
CREATE INDEX IF NOT EXISTS idx_applications_company_owner 
ON applications(company_owner_id) 
WHERE company_owner_id IS NOT NULL;

-- Index for applications with assigned_expert_id (if not exists)
CREATE INDEX IF NOT EXISTS idx_applications_assigned_expert 
ON applications(assigned_expert_id) 
WHERE assigned_expert_id IS NOT NULL;

-- ========== 045_change_is_read_to_uuid_array.sql ==========
-- Migration: Change is_read from boolean to UUID array
-- File: supabase/migrations/045_change_is_read_to_uuid_array.sql
-- This migration changes the is_read column to track which users have read each message

-- Step 1: Drop old indexes that reference is_read as boolean
DROP INDEX IF EXISTS idx_messages_read;
DROP INDEX IF EXISTS idx_messages_conversation_read;
DROP INDEX IF EXISTS idx_messages_conversation_read_sender;
DROP INDEX IF EXISTS idx_messages_unread_conversation;

-- Step 2: Add new column for UUID array (temporary)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_by_users UUID[] DEFAULT ARRAY[]::UUID[];

-- Step 3: Migrate existing data
-- If is_read was true, we can't know which users read it, so leave empty array
-- If is_read was false, also leave empty array (unread by all)
-- Note: This means all existing messages will be marked as unread, which is acceptable

-- Step 4: Drop the old is_read column
ALTER TABLE messages DROP COLUMN IF EXISTS is_read;

-- Step 5: Rename the new column to is_read (for backward compatibility in queries)
ALTER TABLE messages RENAME COLUMN read_by_users TO is_read;

-- Step 6: Create new indexes for array operations
-- Index for checking if a specific user has read messages
CREATE INDEX IF NOT EXISTS idx_messages_is_read_gin ON messages USING GIN (is_read);

-- Index for conversation_id with array operations
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Function to check if a message is unread by a specific user
CREATE OR REPLACE FUNCTION is_message_unread_by_user(message_id UUID, user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT (user_id = ANY(
    SELECT is_read FROM messages WHERE id = message_id
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to add a user to the read_by_users array
CREATE OR REPLACE FUNCTION mark_message_as_read_by_user(message_id UUID, user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE messages
  SET is_read = array_append(is_read, user_id)
  WHERE id = message_id
    AND NOT (user_id = ANY(is_read)); -- Prevent duplicates
END;
$$ LANGUAGE plpgsql;

-- Function to count unread messages for a user in conversations
-- Uses SECURITY DEFINER to bypass RLS and check permissions manually
CREATE OR REPLACE FUNCTION count_unread_messages_for_user(
  conversation_ids UUID[],
  user_id UUID
)
RETURNS TABLE(conversation_id UUID, unread_count BIGINT) 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.conversation_id,
    COUNT(*)::BIGINT as unread_count
  FROM messages m
  WHERE m.conversation_id = ANY(conversation_ids)
    AND m.sender_id != user_id
    AND (
      m.is_read IS NULL 
      OR array_length(m.is_read, 1) IS NULL 
      OR NOT (user_id = ANY(m.is_read))
    )
  GROUP BY m.conversation_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get total unread count for a user across conversations
-- Uses SECURITY DEFINER to bypass RLS and check permissions manually
CREATE OR REPLACE FUNCTION get_total_unread_count_for_user(
  conversation_ids UUID[],
  user_id UUID
)
RETURNS BIGINT 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM messages m
    WHERE m.conversation_id = ANY(conversation_ids)
      AND m.sender_id != user_id
      AND (
        m.is_read IS NULL 
        OR array_length(m.is_read, 1) IS NULL 
        OR NOT (user_id = ANY(m.is_read))
      )
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN messages.is_read IS 'Array of user IDs who have read this message';

-- ========== 046_trigger_notification.sql ==========
-- Migration: Create function to notify message recipients
-- File: supabase/migrations/046_create_notification_for_message_recipients.sql
-- This migration creates a SECURITY DEFINER function that can create notifications
-- for message recipients (admin/expert) when a client sends a message

-- Function to create notifications for message recipients
-- This function runs with SECURITY DEFINER to bypass RLS and create notifications for other users
CREATE OR REPLACE FUNCTION create_message_notifications()
RETURNS TRIGGER AS $$
DECLARE
  app_company_owner_id UUID;
  app_expert_id UUID;
  admin_user_id UUID;
BEGIN
  -- Get application details (company_owner_id and assigned_expert_id)
  SELECT a.company_owner_id, a.assigned_expert_id
  INTO app_company_owner_id, app_expert_id
  FROM conversations c
  INNER JOIN applications a ON a.id = c.application_id
  WHERE c.id = NEW.conversation_id;
  
  -- If we can't find the conversation/application, skip notification creation
  IF app_company_owner_id IS NULL AND app_expert_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get admin user ID (first admin in user_profiles)
  SELECT id INTO admin_user_id
  FROM user_profiles
  WHERE role = 'admin'
  LIMIT 1;
  
  -- Create notification for admin (if message is not from admin)
  IF admin_user_id IS NOT NULL AND NEW.sender_id != admin_user_id THEN
    INSERT INTO notifications (user_id, title, message, type, icon_type)
    VALUES (
      admin_user_id,
      'New Message',
      'You have a new message in an application conversation.',
      'general',
      'bell'
    );
  END IF;
  
  -- Create notification for expert (if message is not from expert and expert is assigned)
  IF app_expert_id IS NOT NULL AND NEW.sender_id != app_expert_id THEN
    INSERT INTO notifications (user_id, title, message, type, icon_type)
    VALUES (
      app_expert_id,
      'New Message',
      'You have a new message in an application conversation.',
      'general',
      'bell'
    );
  END IF;
  
  -- Create notification for company owner (if message is not from company owner)
  IF app_company_owner_id IS NOT NULL AND NEW.sender_id != app_company_owner_id THEN
    INSERT INTO notifications (user_id, title, message, type, icon_type)
    VALUES (
      app_company_owner_id,
      'New Message',
      'You have a new message in an application conversation.',
      'general',
      'bell'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to call the function when a message is inserted
-- Only create notifications for messages that are not from the current user
DROP TRIGGER IF EXISTS create_message_notifications_trigger ON messages;
CREATE TRIGGER create_message_notifications_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION create_message_notifications();

COMMENT ON FUNCTION create_message_notifications() IS 'Creates notifications for message recipients (admin, expert, company owner) when a new message is sent. Runs with SECURITY DEFINER to bypass RLS.';

-- ========== 047.restore_notification_query.sql ==========
-- Fix Notification System Functions
-- Run this in Supabase SQL Editor to restore notification functionality

-- Step 1: Ensure is_read column exists and is UUID array
DO $$
BEGIN
  -- Check if is_read column exists and is correct type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' 
    AND column_name = 'is_read' 
    AND data_type = 'ARRAY'
  ) THEN
    -- If column doesn't exist or is wrong type, fix it
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'messages' 
      AND column_name = 'is_read'
    ) THEN
      -- Column exists but wrong type - drop and recreate
      ALTER TABLE messages DROP COLUMN IF EXISTS is_read;
    END IF;
    
    -- Add column as UUID array
    ALTER TABLE messages ADD COLUMN is_read UUID[] DEFAULT ARRAY[]::UUID[];
  END IF;
END $$;

-- Step 2: Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_messages_is_read_gin ON messages USING GIN (is_read);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Step 3: Recreate mark_message_as_read_by_user function
CREATE OR REPLACE FUNCTION mark_message_as_read_by_user(message_id UUID, user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE messages
  SET is_read = array_append(is_read, user_id)
  WHERE id = message_id
    AND NOT (user_id = ANY(is_read)); -- Prevent duplicates
END;
$$ LANGUAGE plpgsql;

-- Step 4: Recreate is_message_unread_by_user function
CREATE OR REPLACE FUNCTION is_message_unread_by_user(message_id UUID, user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT (user_id = ANY(
    SELECT is_read FROM messages WHERE id = message_id
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 5: Recreate count_unread_messages_for_user function (CRITICAL for notification dropdown)
-- This function MUST have SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION count_unread_messages_for_user(
  conversation_ids UUID[],
  user_id UUID
)
RETURNS TABLE(conversation_id UUID, unread_count BIGINT) 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.conversation_id,
    COUNT(*)::BIGINT as unread_count
  FROM messages m
  WHERE m.conversation_id = ANY(conversation_ids)
    AND m.sender_id != user_id
    AND (
      m.is_read IS NULL 
      OR array_length(m.is_read, 1) IS NULL 
      OR NOT (user_id = ANY(m.is_read))
    )
  GROUP BY m.conversation_id;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Recreate get_total_unread_count_for_user function (CRITICAL for badge count)
-- This function MUST have SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION get_total_unread_count_for_user(
  conversation_ids UUID[],
  user_id UUID
)
RETURNS BIGINT 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM messages m
    WHERE m.conversation_id = ANY(conversation_ids)
      AND m.sender_id != user_id
      AND (
        m.is_read IS NULL 
        OR array_length(m.is_read, 1) IS NULL 
        OR NOT (user_id = ANY(m.is_read))
      )
  );
END;
$$ LANGUAGE plpgsql;

-- Step 7: Add comments for documentation
COMMENT ON COLUMN messages.is_read IS 'Array of user IDs who have read this message';
COMMENT ON FUNCTION mark_message_as_read_by_user(UUID, UUID) IS 'Adds a user ID to the is_read array for a message';
COMMENT ON FUNCTION count_unread_messages_for_user(UUID[], UUID) IS 'Counts unread messages per conversation for a user. Uses SECURITY DEFINER to bypass RLS.';
COMMENT ON FUNCTION get_total_unread_count_for_user(UUID[], UUID) IS 'Gets total unread message count across conversations for a user. Uses SECURITY DEFINER to bypass RLS.';

-- Step 8: Verify functions exist
DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'mark_message_as_read_by_user',
      'is_message_unread_by_user',
      'count_unread_messages_for_user',
      'get_total_unread_count_for_user'
    );
  
  IF func_count = 4 THEN
    RAISE NOTICE 'âœ“ All notification functions created successfully';
  ELSE
    RAISE WARNING 'âš  Expected 4 functions, found %', func_count;
  END IF;
END $$;
-- ========== 048_fix_rpc_functions_with_error_handling.sql ==========
-- Migration: Fix RPC functions with proper error handling
-- File: supabase/migrations/048_fix_rpc_functions_with_error_handling.sql
-- This migration ensures RPC functions handle edge cases and return proper values

-- Function to get total unread count for a user across conversations
-- Uses SECURITY DEFINER to bypass RLS and check permissions manually
CREATE OR REPLACE FUNCTION get_total_unread_count_for_user(
  conversation_ids UUID[],
  user_id UUID
)
RETURNS BIGINT 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  result_count BIGINT;
BEGIN
  -- Validate inputs
  IF user_id IS NULL THEN
    RETURN 0;
  END IF;
  
  IF conversation_ids IS NULL OR array_length(conversation_ids, 1) IS NULL OR array_length(conversation_ids, 1) = 0 THEN
    RETURN 0;
  END IF;
  
  -- Count unread messages
  SELECT COUNT(*)::BIGINT INTO result_count
  FROM messages m
  WHERE m.conversation_id = ANY(conversation_ids)
    AND m.sender_id != user_id
    AND (
      m.is_read IS NULL 
      OR array_length(m.is_read, 1) IS NULL 
      OR NOT (user_id = ANY(m.is_read))
    );
  
  -- Return 0 if result is NULL
  RETURN COALESCE(result_count, 0);
EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return 0 on any exception
    RAISE WARNING 'Error in get_total_unread_count_for_user: %', SQLERRM;
    RETURN 0;
END;
$$;

-- Function to count unread messages for a user in conversations
-- Uses SECURITY DEFINER to bypass RLS and check permissions manually
CREATE OR REPLACE FUNCTION count_unread_messages_for_user(
  conversation_ids UUID[],
  user_id UUID
)
RETURNS TABLE(conversation_id UUID, unread_count BIGINT) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate inputs
  IF user_id IS NULL THEN
    RETURN;
  END IF;
  
  IF conversation_ids IS NULL OR array_length(conversation_ids, 1) IS NULL OR array_length(conversation_ids, 1) = 0 THEN
    RETURN;
  END IF;
  
  -- Return query with error handling
  RETURN QUERY
  SELECT 
    m.conversation_id,
    COUNT(*)::BIGINT as unread_count
  FROM messages m
  WHERE m.conversation_id = ANY(conversation_ids)
    AND m.sender_id != user_id
    AND (
      m.is_read IS NULL 
      OR array_length(m.is_read, 1) IS NULL 
      OR NOT (user_id = ANY(m.is_read))
    )
  GROUP BY m.conversation_id;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error and return empty result on any exception
    RAISE WARNING 'Error in count_unread_messages_for_user: %', SQLERRM;
    RETURN;
END;
$$;

-- Function to mark message as read by user (with error handling)
CREATE OR REPLACE FUNCTION mark_message_as_read_by_user(message_id UUID, user_id UUID)
RETURNS VOID 
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate inputs
  IF message_id IS NULL OR user_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Update message to add user to is_read array
  UPDATE messages
  SET is_read = array_append(COALESCE(is_read, ARRAY[]::UUID[]), user_id)
  WHERE id = message_id
    AND NOT (user_id = ANY(COALESCE(is_read, ARRAY[]::UUID[]))); -- Prevent duplicates
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail
    RAISE WARNING 'Error in mark_message_as_read_by_user: %', SQLERRM;
END;
$$;

-- Add comments
COMMENT ON FUNCTION get_total_unread_count_for_user(UUID[], UUID) IS 'Gets total unread message count across conversations for a user. Uses SECURITY DEFINER to bypass RLS. Returns 0 on error.';
COMMENT ON FUNCTION count_unread_messages_for_user(UUID[], UUID) IS 'Counts unread messages per conversation for a user. Uses SECURITY DEFINER to bypass RLS. Returns empty result on error.';
COMMENT ON FUNCTION mark_message_as_read_by_user(UUID, UUID) IS 'Adds a user ID to the is_read array for a message. Handles NULL values gracefully.';

-- ========== 049_mark_notifications_read_when_message_read.sql ==========
-- Migration: Mark notifications as read when messages are read
-- File: supabase/migrations/049_mark_notifications_read_when_message_read.sql
-- This migration updates the mark_message_as_read_by_user function to also mark
-- related notifications as read when a message is marked as read

-- Enhanced function to mark message as read by user AND mark related notifications as read
CREATE OR REPLACE FUNCTION mark_message_as_read_by_user(message_id UUID, user_id UUID)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg_conversation_id UUID;
  msg_created_at TIMESTAMP WITH TIME ZONE;
  target_user_id UUID;
BEGIN
  -- Store parameter in local variable to avoid ambiguity with column names
  target_user_id := user_id;
  
  -- Validate inputs
  IF message_id IS NULL OR target_user_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Get message details (conversation_id and created_at) for matching notifications
  SELECT conversation_id, created_at
  INTO msg_conversation_id, msg_created_at
  FROM messages
  WHERE id = message_id;
  
  -- If message not found, return
  IF msg_conversation_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Update message to add user to is_read array
  UPDATE messages
  SET is_read = array_append(COALESCE(is_read, ARRAY[]::UUID[]), target_user_id)
  WHERE id = message_id
    AND NOT (target_user_id = ANY(COALESCE(is_read, ARRAY[]::UUID[]))); -- Prevent duplicates
  
  -- Mark related notifications as read
  -- Match notifications that:
  -- 1. Are for this user
  -- 2. Are unread
  -- 3. Are of type 'general' with title 'New Message' (message notifications)
  -- 4. Were created around the same time as the message (within 5 minutes)
  -- This ensures we only mark notifications related to this specific message
  UPDATE notifications
  SET is_read = TRUE
  WHERE notifications.user_id = target_user_id
    AND notifications.is_read = FALSE
    AND notifications.type = 'general'
    AND notifications.title = 'New Message'
    AND notifications.created_at >= msg_created_at - INTERVAL '5 minutes'
    AND notifications.created_at <= msg_created_at + INTERVAL '5 minutes';
    
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail
    RAISE WARNING 'Error in mark_message_as_read_by_user: %', SQLERRM;
END;
$$;

-- Update comment
COMMENT ON FUNCTION mark_message_as_read_by_user(UUID, UUID) IS 'Adds a user ID to the is_read array for a message and marks related notifications as read. Uses SECURITY DEFINER to update notifications. Handles NULL values gracefully.';

-- ========== 050_remove_message_and_icon_type_from_notifications.sql ==========
-- Migration: Remove message and icon_type columns from notifications table
-- File: supabase/migrations/050_remove_message_and_icon_type_from_notifications.sql
-- This migration removes unused columns from the notifications table

-- Step 1: Drop the message column
ALTER TABLE notifications DROP COLUMN IF EXISTS message;

-- Step 2: Drop the icon_type column
ALTER TABLE notifications DROP COLUMN IF EXISTS icon_type;

-- Step 3: Update the create_message_notifications function to not insert message and icon_type
CREATE OR REPLACE FUNCTION create_message_notifications()
RETURNS TRIGGER AS $$
DECLARE
  app_company_owner_id UUID;
  app_expert_id UUID;
  admin_user_id UUID;
BEGIN
  -- Get application details (company_owner_id and assigned_expert_id)
  SELECT a.company_owner_id, a.assigned_expert_id
  INTO app_company_owner_id, app_expert_id
  FROM conversations c
  INNER JOIN applications a ON a.id = c.application_id
  WHERE c.id = NEW.conversation_id;
  
  -- If we can't find the conversation/application, skip notification creation
  IF app_company_owner_id IS NULL AND app_expert_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get admin user ID (first admin in user_profiles)
  SELECT id INTO admin_user_id
  FROM user_profiles
  WHERE role = 'admin'
  LIMIT 1;
  
  -- Create notification for admin (if message is not from admin)
  IF admin_user_id IS NOT NULL AND NEW.sender_id != admin_user_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (
      admin_user_id,
      'New Message',
      'general'
    );
  END IF;
  
  -- Create notification for expert (if message is not from expert and expert is assigned)
  IF app_expert_id IS NOT NULL AND NEW.sender_id != app_expert_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (
      app_expert_id,
      'New Message',
      'general'
    );
  END IF;
  
  -- Create notification for company owner (if message is not from company owner)
  IF app_company_owner_id IS NOT NULL AND NEW.sender_id != app_company_owner_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (
      app_company_owner_id,
      'New Message',
      'general'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update comment
COMMENT ON FUNCTION create_message_notifications() IS 'Creates notifications for message recipients (admin, expert, company owner) when a new message is sent. Runs with SECURITY DEFINER to bypass RLS.';

-- ========== 052_add_expert_steps_to_applications.sql ==========
-- Add is_expert_step and created_by_expert_id fields to application_steps table
-- This allows distinguishing between regular steps and expert-specific steps
-- Note: The application_steps table already exists with the following columns:
--   id, application_id, step_name, step_order, is_completed, completed_at, 
--   completed_by, notes, created_at, updated_at

-- Add is_expert_step column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'application_steps' 
    AND column_name = 'is_expert_step'
  ) THEN
    ALTER TABLE application_steps 
    ADD COLUMN is_expert_step BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add created_by_expert_id column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'application_steps' 
    AND column_name = 'created_by_expert_id'
  ) THEN
    ALTER TABLE application_steps 
    ADD COLUMN created_by_expert_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add description column if it doesn't exist (used in code but may not be in table)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'application_steps' 
    AND column_name = 'description'
  ) THEN
    ALTER TABLE application_steps 
    ADD COLUMN description TEXT;
  END IF;
END $$;

-- Add indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_application_steps_application 
  ON application_steps(application_id);

CREATE INDEX IF NOT EXISTS idx_application_steps_order 
  ON application_steps(application_id, step_order);

CREATE INDEX IF NOT EXISTS idx_application_steps_expert 
  ON application_steps(is_expert_step) 
  WHERE is_expert_step = true;



CREATE POLICY "Expert can insert own application steps"
  ON application_steps FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM applications WHERE assigned_expert_id = auth.uid()
  ));
CREATE POLICY "Expert can delete own application steps"
  ON application_steps FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM applications WHERE assigned_expert_id = auth.uid()
  ));
CREATE POLICY "Expert can update own application steps"
  ON application_steps FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM applications WHERE assigned_expert_id = auth.uid()
  ));

CREATE POLICY "Admin can update own application steps"
  ON application_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    ));

-- Experts and admins: view and update assigned application steps
DROP POLICY IF EXISTS "Experts can view assigned application steps" ON application_steps;
CREATE POLICY "Experts can view assigned application steps"
  ON application_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.assigned_expert_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view assigned application steps" ON application_steps;
CREATE POLICY "Admins can view assigned application steps"
  ON application_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Experts can update assigned application steps" ON application_steps;
CREATE POLICY "Experts can update assigned application steps"
  ON application_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.assigned_expert_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can update assigned application steps" ON application_steps;
CREATE POLICY "Admins can update assigned application steps"
  ON application_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- ========== 053_add_expiry_date_to_license_documents.sql ==========
-- Add expiry_date column to license_documents table
-- This allows documents to have their own expiry date, which can be set to match the license expiry date

ALTER TABLE license_documents
ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- Add index for expiry_date for better query performance
CREATE INDEX IF NOT EXISTS idx_license_documents_expiry_date ON license_documents(expiry_date);

COMMENT ON COLUMN license_documents.expiry_date IS 'Expiry date of the document, typically set to match the license expiry date';

-- ========== 054_add_company_details_fields_to_clients.sql ==========
-- Add company details fields to clients table
-- These fields allow company owners to store comprehensive company information

-- Business Information
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS business_type TEXT,
ADD COLUMN IF NOT EXISTS tax_id TEXT,
ADD COLUMN IF NOT EXISTS primary_license_number TEXT,
ADD COLUMN IF NOT EXISTS website TEXT;

-- Physical Address
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS physical_street_address TEXT,
ADD COLUMN IF NOT EXISTS physical_city TEXT,
ADD COLUMN IF NOT EXISTS physical_state TEXT,
ADD COLUMN IF NOT EXISTS physical_zip_code TEXT;

-- Mailing Address
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS mailing_street_address TEXT,
ADD COLUMN IF NOT EXISTS mailing_city TEXT,
ADD COLUMN IF NOT EXISTS mailing_state TEXT,
ADD COLUMN IF NOT EXISTS mailing_zip_code TEXT;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_clients_business_type ON clients(business_type);
CREATE INDEX IF NOT EXISTS idx_clients_physical_state ON clients(physical_state);

COMMENT ON COLUMN clients.business_type IS 'Type of business (e.g., Home Healthcare Agency)';
COMMENT ON COLUMN clients.tax_id IS 'Tax ID / EIN number';
COMMENT ON COLUMN clients.primary_license_number IS 'Primary license number for the company';
COMMENT ON COLUMN clients.website IS 'Company website URL';
COMMENT ON COLUMN clients.physical_street_address IS 'Physical street address';
COMMENT ON COLUMN clients.physical_city IS 'Physical city';
COMMENT ON COLUMN clients.physical_state IS 'Physical state';
COMMENT ON COLUMN clients.physical_zip_code IS 'Physical ZIP code';
COMMENT ON COLUMN clients.mailing_street_address IS 'Mailing street address (if different from physical)';
COMMENT ON COLUMN clients.mailing_city IS 'Mailing city (if different from physical)';
COMMENT ON COLUMN clients.mailing_state IS 'Mailing state (if different from physical)';
COMMENT ON COLUMN clients.mailing_zip_code IS 'Mailing ZIP code (if different from physical)';

-- ========== 055_add_personal_info_fields_to_user_profiles.sql ==========
-- Add personal information fields to user_profiles table
-- These fields allow users to store additional personal information

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS job_title TEXT,
ADD COLUMN IF NOT EXISTS department TEXT,
ADD COLUMN IF NOT EXISTS work_location TEXT,
ADD COLUMN IF NOT EXISTS start_date DATE;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_phone ON user_profiles(phone);
CREATE INDEX IF NOT EXISTS idx_user_profiles_job_title ON user_profiles(job_title);
CREATE INDEX IF NOT EXISTS idx_user_profiles_department ON user_profiles(department);

COMMENT ON COLUMN user_profiles.phone IS 'User phone number';
COMMENT ON COLUMN user_profiles.job_title IS 'User job title';
COMMENT ON COLUMN user_profiles.department IS 'User department';
COMMENT ON COLUMN user_profiles.work_location IS 'User work location';
COMMENT ON COLUMN user_profiles.start_date IS 'User start date';

-- ========== 056_create_small_clients_table.sql ==========
-- Migration: Create small_clients table for owner client management
-- File: supabase/migrations/056_create_small_clients_table.sql
-- This migration creates a table for managing care recipients/clients

-- Create small_clients table
CREATE TABLE IF NOT EXISTS small_clients (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Personal Information
  full_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT CHECK (gender IN ('Male', 'Female', 'Other', 'Prefer not to say')),
  age INTEGER,
  
  -- Address Information
  street_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  
  -- Contact Information
  phone_number TEXT NOT NULL,
  email_address TEXT NOT NULL,
  
  -- Emergency Contact
  emergency_contact_name TEXT NOT NULL,
  emergency_phone TEXT NOT NULL,
  
  -- Medical Information (Optional)
  primary_diagnosis TEXT,
  current_medications TEXT,
  allergies TEXT,
  
  -- Classification
  class TEXT CHECK (class IN ('Private Pay', 'Medicare', 'Medicaid', 'Other')),
  
  -- Representatives
  representative_1_name TEXT,
  representative_1_relationship TEXT,
  representative_1_phone TEXT,
  representative_2_name TEXT,
  representative_2_relationship TEXT,
  representative_2_phone TEXT,
  
  -- Status
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_small_clients_owner ON small_clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_small_clients_status ON small_clients(status);
CREATE INDEX IF NOT EXISTS idx_small_clients_name ON small_clients(full_name);
CREATE INDEX IF NOT EXISTS idx_small_clients_email ON small_clients(email_address);
CREATE INDEX IF NOT EXISTS idx_small_clients_phone ON small_clients(phone_number);

-- Add trigger for updated_at
CREATE TRIGGER update_small_clients_updated_at BEFORE UPDATE ON small_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE small_clients ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Owners can only view/manage their own clients
CREATE POLICY "Owners can view own clients"
  ON small_clients FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Owners can insert own clients"
  ON small_clients FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can update own clients"
  ON small_clients FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Owners can delete own clients"
  ON small_clients FOR DELETE
  USING (owner_id = auth.uid());

-- Function to calculate age from date_of_birth
CREATE OR REPLACE FUNCTION calculate_age(birth_date DATE)
RETURNS INTEGER AS $$
BEGIN
  RETURN EXTRACT(YEAR FROM AGE(birth_date));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-calculate age when date_of_birth is set or updated
CREATE OR REPLACE FUNCTION update_client_age()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.age := calculate_age(NEW.date_of_birth);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_small_clients_age
  BEFORE INSERT OR UPDATE ON small_clients
  FOR EACH ROW
  EXECUTE FUNCTION update_client_age();

COMMENT ON TABLE small_clients IS 'Care recipients/clients managed by company owners';
COMMENT ON COLUMN small_clients.owner_id IS 'References auth.users(id) - the company owner who manages this client';

-- ========== 057_fix_create_message_notifications_function.sql ==========
-- Migration: Fix create_message_notifications to match notifications table (no message/icon_type)
-- Resolves: column "message" of relation "notifications" does not exist
-- The notifications table no longer has message/icon_type; ensure the trigger function matches.

CREATE OR REPLACE FUNCTION create_message_notifications()
RETURNS TRIGGER AS $$
DECLARE
  app_company_owner_id UUID;
  app_expert_id UUID;
  admin_user_id UUID;
BEGIN
  SELECT a.company_owner_id, a.assigned_expert_id
  INTO app_company_owner_id, app_expert_id
  FROM conversations c
  INNER JOIN applications a ON a.id = c.application_id
  WHERE c.id = NEW.conversation_id;

  IF app_company_owner_id IS NULL AND app_expert_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO admin_user_id
  FROM user_profiles
  WHERE role = 'admin'
  LIMIT 1;

  IF admin_user_id IS NOT NULL AND NEW.sender_id != admin_user_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (admin_user_id, 'New Message', 'general');
  END IF;

  IF app_expert_id IS NOT NULL AND NEW.sender_id != app_expert_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (app_expert_id, 'New Message', 'general');
  END IF;

  IF app_company_owner_id IS NOT NULL AND NEW.sender_id != app_company_owner_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (app_company_owner_id, 'New Message', 'general');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_message_notifications() IS 'Creates notifications for message recipients (admin, expert, company owner) when a new message is sent. Runs with SECURITY DEFINER to bypass RLS.';

-- ========== 058_add_notifications_message_icon_type_back.sql ==========
-- Migration: Add message and icon_type back to notifications (nullable) so trigger never fails
-- Resolves: column "message" of relation "notifications" does not exist
-- If the DB still runs the old create_message_notifications() that inserts message/icon_type,
-- these columns must exist. Adding them as nullable keeps both old and new trigger logic working.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS icon_type TEXT;

-- Optional: ensure the trigger function does not require them (idempotent)
CREATE OR REPLACE FUNCTION create_message_notifications()
RETURNS TRIGGER AS $$
DECLARE
  app_company_owner_id UUID;
  app_expert_id UUID;
  admin_user_id UUID;
BEGIN
  SELECT a.company_owner_id, a.assigned_expert_id
  INTO app_company_owner_id, app_expert_id
  FROM conversations c
  INNER JOIN applications a ON a.id = c.application_id
  WHERE c.id = NEW.conversation_id;

  IF app_company_owner_id IS NULL AND app_expert_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO admin_user_id
  FROM user_profiles
  WHERE role = 'admin'
  LIMIT 1;

  IF admin_user_id IS NOT NULL AND NEW.sender_id != admin_user_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (admin_user_id, 'New Message', 'general');
  END IF;

  IF app_expert_id IS NOT NULL AND NEW.sender_id != app_expert_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (app_expert_id, 'New Message', 'general');
  END IF;

  IF app_company_owner_id IS NOT NULL AND NEW.sender_id != app_company_owner_id THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (app_company_owner_id, 'New Message', 'general');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_message_notifications() IS 'Creates notifications for message recipients when a new message is sent. Inserts (user_id, title, type) only.';

-- ========== 059_add_estimated_days_to_license_requirement_steps.sql ==========
-- Add estimated_days to license_requirement_steps for "Estimated Days" / estimated period
ALTER TABLE license_requirement_steps
ADD COLUMN IF NOT EXISTS estimated_days INTEGER;

-- ========== 060_add_is_required_to_license_requirement_steps.sql ==========
-- Add is_required to license_requirement_steps (like license_requirement_documents)
ALTER TABLE license_requirement_steps
ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT TRUE;

-- ========== 061_notify_admins_on_new_application.sql ==========
-- Migration: Notify admins when owner submits a new application request
-- When an application is inserted with status 'requested', create a notification for each admin user.

CREATE OR REPLACE FUNCTION notify_admins_new_application()
RETURNS TRIGGER AS $$
DECLARE
  admin_record RECORD;
BEGIN
  -- Only run when a new application is created with status 'requested'
  IF NEW.status <> 'requested' THEN
    RETURN NEW;
  END IF;

  -- Insert a notification for each admin user (SECURITY DEFINER bypasses RLS)
  FOR admin_record IN
    SELECT id FROM user_profiles WHERE role = 'admin'
  LOOP
    INSERT INTO notifications (user_id, title, type)
    VALUES (
      admin_record.id,
      'New Application Request',
      'application_update'
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger: after insert on applications
DROP TRIGGER IF EXISTS notify_admins_on_new_application_trigger ON applications;
CREATE TRIGGER notify_admins_on_new_application_trigger
  AFTER INSERT ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_admins_new_application();

COMMENT ON FUNCTION notify_admins_new_application() IS 'Creates a notification for each admin when an owner submits a new application (status requested). Runs with SECURITY DEFINER to bypass RLS.';

-- ========== 062_notify_expert_when_assigned.sql ==========
-- Migration: Notify expert when admin assigns them to an application
-- When an application's assigned_expert_id is set or changed, create a notification for that expert.

CREATE OR REPLACE FUNCTION notify_expert_when_assigned()
RETURNS TRIGGER AS $$
BEGIN
  -- Only run when assigned_expert_id is set and has changed (new assignment or reassignment)
  IF NEW.assigned_expert_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.assigned_expert_id IS NOT NULL AND OLD.assigned_expert_id = NEW.assigned_expert_id THEN
    RETURN NEW;
  END IF;

  -- Insert one notification for the assigned expert (SECURITY DEFINER bypasses RLS)
  INSERT INTO notifications (user_id, title, type)
  VALUES (
    NEW.assigned_expert_id,
    'Application Assigned to You',
    'application_update'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger: after update on applications
DROP TRIGGER IF EXISTS notify_expert_when_assigned_trigger ON applications;
CREATE TRIGGER notify_expert_when_assigned_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_expert_when_assigned();

COMMENT ON FUNCTION notify_expert_when_assigned() IS 'Creates a notification for the expert when admin assigns them to an application. Runs with SECURITY DEFINER to bypass RLS.';

-- ========== 063_notify_expert_on_document_upload.sql ==========
-- Migration: Notify assigned expert when owner uploads a document to an application
-- When a row is inserted into application_documents, create a notification for the application's assigned expert.

CREATE OR REPLACE FUNCTION notify_expert_on_document_upload()
RETURNS TRIGGER AS $$
DECLARE
  expert_id UUID;
BEGIN
  -- Get the assigned expert for this application (if any)
  SELECT assigned_expert_id INTO expert_id
  FROM applications
  WHERE id = NEW.application_id;

  -- Only create notification if the application has an assigned expert
  IF expert_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (
      expert_id,
      'New Document Uploaded',
      'application_update'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger: after insert on application_documents
DROP TRIGGER IF EXISTS notify_expert_on_document_upload_trigger ON application_documents;
CREATE TRIGGER notify_expert_on_document_upload_trigger
  AFTER INSERT ON application_documents
  FOR EACH ROW
  EXECUTE FUNCTION notify_expert_on_document_upload();

COMMENT ON FUNCTION notify_expert_on_document_upload() IS 'Creates a notification for the assigned expert when an owner uploads a document to an application. Runs with SECURITY DEFINER to bypass RLS.';

-- ========== 064_notify_owner_on_document_approved.sql ==========
-- Migration: Notify owner when expert approves a document
-- When an application_document is updated to status 'approved', create a notification for the application's company owner.

CREATE OR REPLACE FUNCTION notify_owner_on_document_approved()
RETURNS TRIGGER AS $$
DECLARE
  owner_id UUID;
BEGIN
  -- Only run when status changes to 'approved'
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Get the company owner for this application
  SELECT company_owner_id INTO owner_id
  FROM applications
  WHERE id = NEW.application_id;

  IF owner_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (
      owner_id,
      'Document Approved',
      'document_approved'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger: after update on application_documents
DROP TRIGGER IF EXISTS notify_owner_on_document_approved_trigger ON application_documents;
CREATE TRIGGER notify_owner_on_document_approved_trigger
  AFTER UPDATE ON application_documents
  FOR EACH ROW
  EXECUTE FUNCTION notify_owner_on_document_approved();

COMMENT ON FUNCTION notify_owner_on_document_approved() IS 'Creates a notification for the company owner when an expert approves a document. Runs with SECURITY DEFINER to bypass RLS.';

-- ========== 065_notify_owner_on_application_approved.sql ==========
-- Migration: Notify owner when admin approves a requested application
-- When an application's status is updated to 'approved', create a notification for the application's company owner.

CREATE OR REPLACE FUNCTION notify_owner_on_application_approved()
RETURNS TRIGGER AS $$
BEGIN
  -- Only run when status changes to 'approved'
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Insert notification for the company owner (SECURITY DEFINER bypasses RLS)
  IF NEW.company_owner_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, type)
    VALUES (
      NEW.company_owner_id,
      'Application Approved',
      'application_update'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger: after update on applications
DROP TRIGGER IF EXISTS notify_owner_on_application_approved_trigger ON applications;
CREATE TRIGGER notify_owner_on_application_approved_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_owner_on_application_approved();

COMMENT ON FUNCTION notify_owner_on_application_approved() IS 'Creates a notification for the company owner when admin approves a requested application (status becomes approved). Runs with SECURITY DEFINER to bypass RLS.';

-- ========== 066_add_expert_step_and_phase_to_license_requirement_steps.sql ==========
-- Add is_expert_step and phase to license_requirement_steps for Expert Process steps
ALTER TABLE license_requirement_steps
ADD COLUMN IF NOT EXISTS is_expert_step BOOLEAN DEFAULT FALSE;

ALTER TABLE license_requirement_steps
ADD COLUMN IF NOT EXISTS phase TEXT;

CREATE INDEX IF NOT EXISTS idx_license_requirement_steps_expert
  ON license_requirement_steps(license_requirement_id, is_expert_step)
  WHERE is_expert_step = true;

-- ========== 066_license_requirement_templates.sql (with category) ==========
-- Document templates for license requirements (sample documents admins can upload for agency admins to download).
-- Ensure a storage bucket named "license-templates" exists in Supabase Storage (public or with appropriate RLS) for uploads.
--
-- If the table doesn't appear after running: the SQL Editor runs all statements in one transaction; if any
-- statement fails (e.g. policy), the whole transaction rolls back. Run "Part 1" first, then "Part 2".

-- Part 1: Table and RLS (run this first)
CREATE TABLE IF NOT EXISTS public.license_requirement_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  license_requirement_id UUID REFERENCES public.license_requirements(id) ON DELETE CASCADE NOT NULL,
  template_name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requirement_templates_requirement ON public.license_requirement_templates(license_requirement_id);

ALTER TABLE public.license_requirement_templates ENABLE ROW LEVEL SECURITY;

-- Part 2: Policy and comment (run after Part 1; if this fails, the table from Part 1 will still exist)
DROP POLICY IF EXISTS "Admins can manage requirement templates" ON public.license_requirement_templates;
CREATE POLICY "Admins can manage requirement templates"
  ON public.license_requirement_templates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

COMMENT ON TABLE public.license_requirement_templates IS 'Sample document templates per license requirement that agency admins can download when their application is approved.';

-- ========== 067_add_license_requirement_document_id_to_application_documents.sql ==========
-- Link application_documents to license_requirement_documents so each upload fulfills a requirement template
ALTER TABLE application_documents
  ADD COLUMN IF NOT EXISTS license_requirement_document_id UUID REFERENCES license_requirement_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_application_documents_requirement_doc
  ON application_documents(license_requirement_document_id);

COMMENT ON COLUMN application_documents.license_requirement_document_id IS 'The license requirement document this upload fulfills (template).';

-- ========== add_description_to_license_requirement_documents.sql ==========
-- Fix: Could not find the 'description' column of 'license_requirement_documents' in the schema cache.
-- Ensures the description column exists (for DBs created before this was added).
ALTER TABLE license_requirement_documents ADD COLUMN IF NOT EXISTS description TEXT;

-- ========== rpc_copy_expert_steps_to_application.sql ==========
-- RPC called from client when company owner submits new license request (avoids Server Action RSC "frame.join" error).
CREATE OR REPLACE FUNCTION copy_expert_steps_to_application(
  p_application_id UUID,
  p_state TEXT,
  p_license_type_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requirement_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM application_steps
    WHERE application_id = p_application_id AND is_expert_step = true
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  SELECT id INTO v_requirement_id
  FROM license_requirements
  WHERE state = p_state AND license_type = p_license_type_name
  LIMIT 1;

  IF v_requirement_id IS NULL THEN
    INSERT INTO license_requirements (state, license_type)
    VALUES (p_state, p_license_type_name)
    RETURNING id INTO v_requirement_id;
  END IF;

  INSERT INTO application_steps (
    application_id,
    step_name,
    step_order,
    description,
    instructions,
    phase,
    is_expert_step,
    is_completed
  )
  SELECT
    p_application_id,
    step_name,
    step_order,
    description,
    instructions,
    phase,
    true,
    false
  FROM license_requirement_steps
  WHERE license_requirement_id = v_requirement_id
    AND COALESCE(is_expert_step, false) = true
  ORDER BY step_order;
END;
$$;

COMMENT ON FUNCTION copy_expert_steps_to_application(UUID, TEXT, TEXT) IS
  'Copies expert step templates to application_steps. Called from client after creating an application.';

-- ========== 067_storage_bucket_license_templates.sql ==========
-- Create the license-templates storage bucket for document template uploads.
-- If this migration fails (e.g. "permission denied" or "relation does not exist"),
-- create the bucket manually: Supabase Dashboard â†’ Storage â†’ New bucket â†’ name: license-templates â†’ Public: ON.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'license-templates',
  'license-templates',
  true,
  52428800,
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ========== 068_allow_read_license_requirement_tables_for_owners_experts.sql ==========
-- Allow company owners and experts to read license requirement templates (steps, documents)
-- so the Documents tab and Next Steps can display the requirement template for their application.
-- Admins keep full manage access via existing policies; these add SELECT only for authenticated users.

CREATE POLICY "Authenticated users can read license requirements"
  ON license_requirements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read license requirement steps"
  ON license_requirement_steps FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read license requirement documents"
  ON license_requirement_documents FOR SELECT
  TO authenticated
  USING (true);

-- ========== 068_storage_policies_license_templates.sql ==========
-- RLS policies for license-templates storage bucket.
-- Fixes "new row violates row-level security policy" when uploading templates.
-- Admins can insert/update/delete; anyone can read (public bucket).

DROP POLICY IF EXISTS "Admins can upload license templates" ON storage.objects;
CREATE POLICY "Admins can upload license templates"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'license-templates'
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Anyone can read license templates" ON storage.objects;
CREATE POLICY "Anyone can read license templates"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'license-templates');

DROP POLICY IF EXISTS "Admins can update license templates" ON storage.objects;
CREATE POLICY "Admins can update license templates"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'license-templates'
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    bucket_id = 'license-templates'
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Admins can delete license templates" ON storage.objects;
CREATE POLICY "Admins can delete license templates"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'license-templates'
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ========== 080_storage_bucket_application_documents.sql ==========
-- Create the application-documents storage bucket for application document uploads.
-- Public bucket; allowed_mime_types = NULL means any MIME type.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'application-documents',
  'application-documents',
  true,
  52428800,
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- application-documents bucket: only two policies — authenticated read and upload
DROP POLICY IF EXISTS "Company owners can upload application documents" ON storage.objects;
DROP POLICY IF EXISTS "Company owners can read application documents" ON storage.objects;
DROP POLICY IF EXISTS "Company owners can update application documents" ON storage.objects;
DROP POLICY IF EXISTS "Company owners can delete application documents" ON storage.objects;
DROP POLICY IF EXISTS "Experts can read application documents" ON storage.objects;
DROP POLICY IF EXISTS "Experts can update application documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can manage application documents" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can read application-documents" ON storage.objects;
CREATE POLICY "Authenticated users can read application-documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'application-documents');

DROP POLICY IF EXISTS "Authenticated users can upload application-documents" ON storage.objects;
CREATE POLICY "Authenticated users can upload application-documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'application-documents');

-- ========== 069_add_phase_to_application_steps.sql ==========
-- Add phase column to application_steps for expert steps (align with license requirement expert steps)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'application_steps'
    AND column_name = 'phase'
  ) THEN
    ALTER TABLE application_steps
    ADD COLUMN phase TEXT;
  END IF;
END $$;

-- ========== 070_document_status_draft_and_submit_flow.sql ==========
-- Document template workflow: draft -> (owner submit) -> pending -> expert approve -> completed (approved) or expert reject -> draft
-- 1. Add 'draft' status. New uploads start as 'draft'; owner submits -> 'pending'; expert approves -> 'approved'; expert rejects -> 'draft'
-- 2. Existing rows that were 'pending' (old "just uploaded") become 'draft' so owner can submit.

-- First allow 'draft' in the constraint (must do this before any INSERT/UPDATE with status 'draft')
ALTER TABLE application_documents
  DROP CONSTRAINT IF EXISTS application_documents_status_check;

ALTER TABLE application_documents
  ADD CONSTRAINT application_documents_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected'));

ALTER TABLE application_documents
  ALTER COLUMN status SET DEFAULT 'draft';

-- Migrate existing "pending" (previously meaning just uploaded) to draft so new submit flow applies
UPDATE application_documents SET status = 'draft' WHERE status = 'pending';

-- New rows default to 'draft' when created by owner upload
COMMENT ON COLUMN application_documents.status IS 'draft=just uploaded; pending=submitted for review; approved=expert approved (UI: completed); rejected=expert rejected, back to draft';

-- Notify expert when owner submits a document (status changes from draft to pending)
CREATE OR REPLACE FUNCTION notify_expert_on_document_submitted()
RETURNS TRIGGER AS $$
DECLARE
  expert_id UUID;
BEGIN
  IF (OLD.status = 'draft' OR OLD.status = 'rejected') AND NEW.status = 'pending' THEN
    SELECT assigned_expert_id INTO expert_id
    FROM applications
    WHERE id = NEW.application_id;

    IF expert_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, type)
      VALUES (
        expert_id,
        'Document Submitted for Review',
        'application_update'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS notify_expert_on_document_submitted_trigger ON application_documents;
CREATE TRIGGER notify_expert_on_document_submitted_trigger
  AFTER UPDATE ON application_documents
  FOR EACH ROW
  EXECUTE FUNCTION notify_expert_on_document_submitted();

COMMENT ON FUNCTION notify_expert_on_document_submitted() IS 'Notifies assigned expert when owner submits a document (draft -> pending).';

-- Notify expert only when owner submits (draft -> pending), not on every upload (draft).
DROP TRIGGER IF EXISTS notify_expert_on_document_upload_trigger ON application_documents;

-- ========== 071_applications_status_allow_closed.sql ==========
-- Allow 'closed' (and 'requested', 'cancelled') on applications.status so expert/admin can close completed applications.
-- PostgreSQL names the inline CHECK as applications_status_check.

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_status_check
  CHECK (status IN (
    'requested',
    'in_progress',
    'under_review',
    'needs_revision',
    'approved',
    'rejected',
    'cancelled',
    'closed'
  ));

-- ========== 072_enable_realtime_messages_notifications.sql ==========
-- Enable Realtime (postgres_changes) for messages and notifications tables.
-- Without this, subscriptions to postgres_changes on these tables get CHANNEL_ERROR.
-- See: https://supabase.com/docs/guides/realtime/postgres-changes

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;

-- ========== 073_application_steps_rls_company_owners.sql ==========
-- Allow company owners to read and modify application_steps for their own applications.
-- Fixes: "new row violates row-level security policy for table application_steps"
-- when the owner creates an application (copyExpertStepsFromRequirementToApplication)
-- or when the owner completes a step (insert/update in ApplicationDetailContent).

DROP POLICY IF EXISTS "Company owners can view own application steps" ON application_steps;
CREATE POLICY "Company owners can view own application steps"
  ON application_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Company owners can insert own application steps" ON application_steps;
CREATE POLICY "Company owners can insert own application steps"
  ON application_steps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Company owners can update own application steps" ON application_steps;
CREATE POLICY "Company owners can update own application steps"
  ON application_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Company owners can delete own application steps" ON application_steps;
CREATE POLICY "Company owners can delete own application steps"
  ON application_steps FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM applications
      WHERE applications.id = application_steps.application_id
      AND applications.company_owner_id = auth.uid()
    )
  );

-- ========== 074_allow_read_license_requirement_templates.sql ==========
-- Allow authenticated users (company owners, experts) to read license requirement templates
-- so they can download admin-uploaded templates on the application detail Templates tab.

CREATE POLICY "Authenticated users can read license requirement templates"
  ON public.license_requirement_templates
  FOR SELECT
  TO authenticated
  USING (true);

-- ========== 075_initialize_application_steps.sql ==========
-- When admin approves (requested -> in_progress), initialize application_steps from main steps only.
-- Expert steps may already exist (added at creation); we append main steps with step_order after existing.
DROP FUNCTION IF EXISTS public.initialize_application_steps() CASCADE;
CREATE OR REPLACE FUNCTION initialize_application_steps_on_approval()
RETURNS TRIGGER AS $$
DECLARE
  license_type_name TEXT;
  license_requirement_uuid UUID;
  step_record RECORD;
  next_step_order INTEGER;
BEGIN
  -- Only initialize steps when status changes from 'requested' to 'in_progress'
  IF NEW.status = 'in_progress' AND OLD.status = 'requested' AND NEW.license_type_id IS NOT NULL THEN
    -- Get license type name
    SELECT name INTO license_type_name
    FROM license_types
    WHERE id = NEW.license_type_id;

    IF license_type_name IS NULL THEN
      RETURN NEW;
    END IF;

    -- Find license_requirement_id for this state and license type
    SELECT id INTO license_requirement_uuid
    FROM license_requirements
    WHERE state = NEW.state 
      AND license_type = license_type_name
    LIMIT 1;

    IF license_requirement_uuid IS NOT NULL THEN
      -- Start step_order after any existing steps (e.g. expert steps added at application creation)
      SELECT COALESCE(MAX(step_order), 0) + 1 INTO next_step_order
      FROM application_steps
      WHERE application_id = NEW.id;

      -- Create application_steps entries for main steps only (expert steps already added at creation)
      FOR step_record IN
        SELECT step_name, step_order, instructions
        FROM license_requirement_steps
        WHERE license_requirement_id = license_requirement_uuid
          AND COALESCE(is_expert_step, false) = false
        ORDER BY step_order
      LOOP
        INSERT INTO application_steps (application_id, step_name, step_order, instructions, is_completed)
        VALUES (NEW.id, step_record.step_name, next_step_order, step_record.instructions, FALSE);
        next_step_order := next_step_order + 1;
      END LOOP;

      -- Progress will be recalculated automatically by the trigger when steps are inserted
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER initialize_application_steps_on_approval_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION initialize_application_steps_on_approval();

-- ========== 076_recalculate_application_progress_steps_documents_only.sql ==========
-- Overall application progress depends only on main steps (is_expert_step = false) and documents.
-- Expert process steps are excluded from progress calculation.
-- Recalculate when application_steps or application_documents change.

CREATE OR REPLACE FUNCTION recalculate_application_progress(p_application_id UUID)
RETURNS VOID AS $$
DECLARE
  total_steps INTEGER;
  completed_steps INTEGER;
  total_docs INTEGER;
  completed_docs INTEGER;
  denominator INTEGER;
  new_progress INTEGER;
  req_id UUID;
  lt_name TEXT;
  lt_state TEXT;
BEGIN
  -- Main steps only (exclude expert process)
  SELECT COUNT(*) INTO total_steps
  FROM application_steps
  WHERE application_id = p_application_id
    AND COALESCE(is_expert_step, false) = false;

  SELECT COUNT(*) INTO completed_steps
  FROM application_steps
  WHERE application_id = p_application_id
    AND COALESCE(is_expert_step, false) = false
    AND is_completed = true;

  -- Total documents: from license_requirement_documents when app has license_type_id, else count of application_documents
  SELECT lt.name, COALESCE(lt.state, a.state)
  INTO lt_name, lt_state
  FROM applications a
  LEFT JOIN license_types lt ON lt.id = a.license_type_id
  WHERE a.id = p_application_id;

  IF lt_name IS NOT NULL AND lt_state IS NOT NULL THEN
    SELECT lr.id INTO req_id
    FROM license_requirements lr
    WHERE lr.state = lt_state AND lr.license_type = lt_name
    LIMIT 1;
    IF req_id IS NOT NULL THEN
      SELECT COUNT(*) INTO total_docs FROM license_requirement_documents WHERE license_requirement_id = req_id;
    END IF;
  END IF;

  IF total_docs IS NULL OR total_docs = 0 THEN
    SELECT COUNT(*) INTO total_docs FROM application_documents WHERE application_id = p_application_id;
  END IF;

  -- Completed documents: approved or completed status
  SELECT COUNT(*) INTO completed_docs
  FROM application_documents
  WHERE application_id = p_application_id
    AND status IN ('approved', 'completed');

  denominator := COALESCE(total_steps, 0) + COALESCE(total_docs, 0);
  IF denominator = 0 THEN
    new_progress := 0;
  ELSE
    new_progress := LEAST(100, ROUND(100.0 * (COALESCE(completed_steps, 0) + COALESCE(completed_docs, 0)) / denominator));
  END IF;

  UPDATE applications
  SET progress_percentage = new_progress
  WHERE id = p_application_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ========== calculate_application_progress (returns integer, updates application) ==========
CREATE OR REPLACE FUNCTION calculate_application_progress(application_uuid UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_items INTEGER;
  completed_items INTEGER;
  progress_percent INTEGER;
  license_type_uuid UUID;
  license_type_name TEXT;
  app_state TEXT;
  total_documents INTEGER;
  total_steps INTEGER;
  uploaded_documents INTEGER;
  completed_steps INTEGER;
  license_requirement_uuid UUID;
BEGIN
  -- Get license_type_id, state, and license type name from application
  SELECT a.license_type_id, a.state, lt.name
  INTO license_type_uuid, app_state, license_type_name
  FROM applications a
  LEFT JOIN license_types lt ON lt.id = a.license_type_id
  WHERE a.id = application_uuid;

  IF license_type_uuid IS NULL OR license_type_name IS NULL OR app_state IS NULL THEN
    RETURN 0;
  END IF;

  -- Find license_requirement_id for this state and license type
  SELECT id INTO license_requirement_uuid
  FROM license_requirements
  WHERE state = app_state
    AND license_type = license_type_name
  LIMIT 1;

  -- Count total documents required for this license requirement
  IF license_requirement_uuid IS NOT NULL THEN
    SELECT COUNT(*) INTO total_documents
    FROM license_requirement_documents
    WHERE license_requirement_id = license_requirement_uuid;
  ELSE
    total_documents := 0;
  END IF;

  -- Count total steps for this license requirement
  IF license_requirement_uuid IS NOT NULL THEN
    SELECT COUNT(*) INTO total_steps
    FROM license_requirement_steps
    WHERE license_requirement_id = license_requirement_uuid;
  ELSE
    total_steps := 0;
  END IF;

  -- Count uploaded documents for this application
  SELECT COUNT(*) INTO uploaded_documents
  FROM application_documents
  WHERE application_id = application_uuid;

  -- Count completed steps for this application
  SELECT COUNT(*) INTO completed_steps
  FROM application_steps
  WHERE application_id = application_uuid
    AND is_completed = TRUE;

  -- Calculate total items and completed items
  total_items := COALESCE(total_documents, 0) + COALESCE(total_steps, 0);
  completed_items := COALESCE(uploaded_documents, 0) + COALESCE(completed_steps, 0);

  -- Calculate progress percentage
  IF total_items > 0 THEN
    progress_percent := ROUND((completed_items::DECIMAL / total_items::DECIMAL) * 100);
  ELSE
    progress_percent := 0;
  END IF;

  -- Ensure progress is between 0 and 100
  IF progress_percent < 0 THEN
    progress_percent := 0;
  ELSIF progress_percent > 100 THEN
    progress_percent := 100;
  END IF;

  -- Update the application progress (for in_progress and under_review applications)
  -- Note: Status change to 'under_review' when progress = 100% is handled by trigger
  UPDATE applications
  SET progress_percentage = progress_percent,
      last_updated_date = CURRENT_DATE
  WHERE id = application_uuid
    AND status IN ('in_progress', 'under_review');

  RETURN progress_percent;
END;
$$;

-- ========== check_application_ownership ==========
CREATE OR REPLACE FUNCTION check_application_ownership(app_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id UUID;
  current_user_id UUID;
BEGIN
  -- Get the current authenticated user ID
  current_user_id := auth.uid();

  -- If no user is authenticated, return false
  IF current_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Explicitly query with SECURITY DEFINER privileges to bypass RLS
  -- Using public.applications to ensure we're querying the right table
  SELECT company_owner_id INTO owner_id
  FROM public.applications
  WHERE id = app_id;

  -- Return true if the application exists and belongs to the current user
  RETURN owner_id IS NOT NULL AND owner_id = current_user_id;
END;
$$;

-- Trigger: after application_steps change (main or expert; we only count main in the function)
CREATE OR REPLACE FUNCTION trigger_recalculate_progress_on_steps()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_application_progress(OLD.application_id);
    RETURN OLD;
  END IF;
  PERFORM recalculate_application_progress(NEW.application_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS recalculate_progress_on_application_steps_trigger ON application_steps;
CREATE TRIGGER recalculate_progress_on_application_steps_trigger
  AFTER INSERT OR UPDATE OR DELETE ON application_steps
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalculate_progress_on_steps();

-- Trigger: after application_documents change
CREATE OR REPLACE FUNCTION trigger_recalculate_progress_on_documents()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_application_progress(OLD.application_id);
    RETURN OLD;
  END IF;
  PERFORM recalculate_application_progress(NEW.application_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS recalculate_progress_on_application_documents_trigger ON application_documents;
CREATE TRIGGER recalculate_progress_on_application_documents_trigger
  AFTER INSERT OR UPDATE OF status OR DELETE ON application_documents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_recalculate_progress_on_documents();

-- Backfill progress for all existing applications
DO $$
DECLARE
  app_record RECORD;
BEGIN
  FOR app_record IN SELECT id FROM applications
  LOOP
    PERFORM recalculate_application_progress(app_record.id);
  END LOOP;
END $$;

-- ========== RLS_fixed.sql ==========
-- Migration: Add Admin RLS Policies for staff_members
-- File: supabase/migrations/019_add_admin_staff_members_policies.sql
-- This migration adds RLS policies to allow admins to view and manage all staff_members

-- RLS Policies for staff_members - Allow admins to view all staff
DROP POLICY IF EXISTS "Admins can view all staff_members" ON staff_members;
CREATE POLICY "Admins can view all staff_members"
  ON staff_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for staff_members - Allow admins to manage all staff
DROP POLICY IF EXISTS "Admins can manage staff_members" ON staff_members;
CREATE POLICY "Admins can manage staff_members"
  ON staff_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for staff_licenses - Allow admins to view all staff licenses
DROP POLICY IF EXISTS "Admins can view all staff_licenses" ON staff_licenses;
CREATE POLICY "Admins can view all staff_licenses"
  ON staff_licenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );

-- RLS Policies for staff_licenses - Allow admins to manage all staff licenses
DROP POLICY IF EXISTS "Admins can manage staff_licenses" ON staff_licenses;
CREATE POLICY "Admins can manage staff_licenses"
  ON staff_licenses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.role = 'admin'
    )
  );
-- ========== 026_restore_messages_rls_to_original.sql ==========

-- ========== 027_restore_messages_rls_to_original.sql ==========

-- ========== audit_logs table and create_audit_log trigger ==========
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  clinic_id UUID,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_id ON audit_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow admins to view audit logs (optional; add policies as needed)
DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION create_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, new_values)
    VALUES (
      auth.uid(),
      NEW.clinic_id,
      'INSERT',
      TG_TABLE_NAME,
      NEW.id,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, old_values, new_values)
    VALUES (
      auth.uid(),
      NEW.clinic_id,
      'UPDATE',
      TG_TABLE_NAME,
      NEW.id,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, old_values)
    VALUES (
      auth.uid(),
      OLD.clinic_id,
      'DELETE',
      TG_TABLE_NAME,
      OLD.id,
      to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION create_audit_log() IS 'Trigger function: logs INSERT/UPDATE/DELETE to audit_logs. Attach to tables that have id and clinic_id. SECURITY DEFINER.';

-- ========== create_demo_user ==========
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION create_demo_user(
  email_address TEXT,
  password_text TEXT,
  full_name_text TEXT,
  role_text TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgcrypto
AS $$
DECLARE
  user_id UUID;
  encrypted_pw TEXT;
  instance_uuid UUID;
  now_ts TIMESTAMPTZ;
BEGIN
  now_ts := NOW();

  SELECT COALESCE(
    (SELECT instance_id FROM auth.users LIMIT 1),
    (SELECT id FROM auth.instances LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ) INTO instance_uuid;

  user_id := gen_random_uuid();
  encrypted_pw := crypt(password_text, gen_salt('bf', 10));

  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    invited_at,
    confirmation_token,
    confirmation_sent_at,
    recovery_token,
    recovery_sent_at,
    email_change_token_new,
    email_change,
    email_change_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at,
    phone,
    phone_confirmed_at,
    phone_change,
    phone_change_token,
    phone_change_sent_at,
    confirmed_at,
    email_change_token_current,
    email_change_confirm_status,
    banned_until,
    reauthentication_token,
    reauthentication_sent_at,
    is_sso_user,
    deleted_at,
    aud,
    role
  ) VALUES (
    user_id,
    instance_uuid,
    LOWER(TRIM(email_address)),
    encrypted_pw,
    now_ts,
    NULL,
    '',
    NULL,
    '',
    NULL,
    '',
    '',
    NULL,
    NULL,
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', full_name_text, 'role', role_text),
    FALSE,
    now_ts,
    now_ts,
    NULL,
    NULL,
    '',
    '',
    NULL,
    now_ts,
    '',
    0,
    NULL,
    '',
    NULL,
    FALSE,
    NULL,
    'authenticated',
    'authenticated'
  );

  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (user_id, LOWER(TRIM(email_address)), full_name_text, role_text)
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    email = EXCLUDED.email,
    updated_at = now_ts;

  RETURN user_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error creating user %: %', email_address, SQLERRM;
    RETURN NULL;
END;
$$;

-- ========== create_expert_user_and_record ==========
CREATE OR REPLACE FUNCTION create_expert_user_and_record(
  email_address TEXT,
  password_text TEXT,
  first_name_text TEXT,
  last_name_text TEXT,
  phone_text TEXT,
  expertise_text TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgcrypto
AS $$
DECLARE
  user_id UUID;
  expert_id UUID;
  encrypted_pw TEXT;
  instance_uuid UUID;
  now_ts TIMESTAMPTZ;
BEGIN
  now_ts := NOW();

  SELECT COALESCE(
    (SELECT instance_id FROM auth.users LIMIT 1),
    (SELECT id FROM auth.instances LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ) INTO instance_uuid;

  SELECT id INTO user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(email_address))
  LIMIT 1;

  IF user_id IS NULL THEN
    user_id := gen_random_uuid();
    encrypted_pw := crypt(password_text, gen_salt('bf', 10));

    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      invited_at,
      confirmation_token,
      confirmation_sent_at,
      recovery_token,
      recovery_sent_at,
      email_change_token_new,
      email_change,
      email_change_sent_at,
      last_sign_in_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at,
      phone,
      phone_confirmed_at,
      phone_change,
      phone_change_token,
      phone_change_sent_at,
      confirmed_at,
      email_change_token_current,
      email_change_confirm_status,
      banned_until,
      reauthentication_token,
      reauthentication_sent_at,
      is_sso_user,
      deleted_at,
      aud,
      role
    ) VALUES (
      user_id,
      instance_uuid,
      LOWER(TRIM(email_address)),
      encrypted_pw,
      now_ts,
      NULL,
      '',
      NULL,
      '',
      NULL,
      '',
      '',
      NULL,
      NULL,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', first_name_text || ' ' || last_name_text, 'role', 'expert'),
      FALSE,
      now_ts,
      now_ts,
      phone_text,
      NULL,
      '',
      '',
      NULL,
      now_ts,
      '',
      0,
      NULL,
      '',
      NULL,
      FALSE,
      NULL,
      'authenticated',
      'authenticated'
    );

    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (user_id, LOWER(TRIM(email_address)), first_name_text || ' ' || last_name_text, 'expert')
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      email = EXCLUDED.email,
      updated_at = now_ts;
  END IF;

  INSERT INTO licensing_experts (user_id, first_name, last_name, email, phone, status, expertise)
  VALUES (
    user_id,
    first_name_text,
    last_name_text,
    LOWER(TRIM(email_address)),
    phone_text,
    'active',
    expertise_text
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    expertise = EXCLUDED.expertise,
    updated_at = now_ts
  RETURNING id INTO expert_id;

  RETURN expert_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error creating expert %: %', email_address, SQLERRM;
    RETURN NULL;
END;
$$;

-- ========== create_license_on_approval (trigger function) ==========
CREATE OR REPLACE FUNCTION create_license_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_license_id UUID;
  license_type_record RECORD;
  expiry_date_calc DATE;
  renewal_due_date_calc DATE;
BEGIN
  -- Only create license if status changed from 'under_review' to 'approved'
  IF NEW.status = 'approved' AND OLD.status = 'under_review' THEN
    -- Get license type information to calculate expiry date
    SELECT lt.name, lt.renewal_period_years INTO license_type_record
    FROM license_types lt
    WHERE lt.id = NEW.license_type_id;

    -- Calculate expiry date (default to 1 year from today if not specified)
    IF license_type_record IS NULL OR license_type_record.renewal_period_years IS NULL THEN
      expiry_date_calc := (CURRENT_DATE + INTERVAL '1 year')::DATE;
    ELSE
      expiry_date_calc := (CURRENT_DATE + (license_type_record.renewal_period_years::TEXT || ' years')::INTERVAL)::DATE;
    END IF;

    -- Calculate renewal due date (60 days before expiry)
    renewal_due_date_calc := (expiry_date_calc - INTERVAL '60 days')::DATE;

    -- Create license record
    INSERT INTO licenses (
      company_owner_id,
      state,
      license_name,
      license_number,
      status,
      activated_date,
      expiry_date,
      renewal_due_date
    )
    VALUES (
      NEW.company_owner_id,
      NEW.state,
      NEW.application_name,
      'LIC-' || UPPER(SUBSTRING(NEW.id::TEXT FROM 1 FOR 8)) || '-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD'),
      'active',
      CURRENT_DATE,
      expiry_date_calc,
      renewal_due_date_calc
    )
    RETURNING id INTO new_license_id;

    -- Copy application documents to license documents
    INSERT INTO license_documents (
      license_id,
      document_name,
      document_url,
      document_type
    )
    SELECT
      new_license_id,
      ad.document_name,
      ad.document_url,
      ad.document_type
    FROM application_documents ad
    WHERE ad.application_id = NEW.id;

    -- Notify owner that license has been created
    INSERT INTO notifications (user_id, title, message, type, icon_type)
    VALUES (
      NEW.company_owner_id,
      'License Approved and Created',
      'Your application "' || NEW.application_name || '" (' || NEW.state || ') has been approved and your license is now active.',
      'application_update',
      'check'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_license_on_approval_trigger ON applications;
CREATE TRIGGER create_license_on_approval_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION create_license_on_approval();

-- ========== create_notification ==========
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT,
  p_icon_type TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (
    user_id,
    title,
    message,
    type,
    icon_type
  ) VALUES (
    p_user_id,
    p_title,
    p_message,
    p_type,
    p_icon_type
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

-- ========== create_or_update_demo_user ==========
CREATE OR REPLACE FUNCTION create_or_update_demo_user(
  email_address TEXT,
  password_text TEXT,
  full_name_text TEXT,
  role_text TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgcrypto
AS $$
DECLARE
  user_id UUID;
  encrypted_pw TEXT;
  instance_uuid UUID;
  existing_user_id UUID;
BEGIN
  SELECT id INTO existing_user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(email_address));

  SELECT COALESCE(
    (SELECT instance_id FROM auth.users LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ) INTO instance_uuid;

  encrypted_pw := crypt(password_text, gen_salt('bf', 10));

  IF existing_user_id IS NOT NULL THEN
    UPDATE auth.users
    SET
      encrypted_password = encrypted_pw,
      email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
      raw_user_meta_data = jsonb_build_object('full_name', full_name_text, 'role', role_text),
      updated_at = NOW()
    WHERE id = existing_user_id;

    user_id := existing_user_id;
  ELSE
    user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      aud,
      role,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token,
      phone,
      phone_confirmed_at,
      confirmed_at,
      last_sign_in_at,
      banned_until
    ) VALUES (
      user_id,
      instance_uuid,
      LOWER(TRIM(email_address)),
      encrypted_pw,
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', full_name_text, 'role', role_text),
      NOW(),
      NOW(),
      'authenticated',
      'authenticated',
      '',
      '',
      '',
      '',
      NULL,
      NULL,
      NOW(),
      NULL,
      NULL
    );
  END IF;

  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (user_id, LOWER(TRIM(email_address)), full_name_text, role_text)
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    email = EXCLUDED.email,
    updated_at = NOW();

  RETURN user_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error creating/updating user %: %', email_address, SQLERRM;
    RETURN NULL;
END;
$$;

-- ========== create_super_admin_profile ==========
-- Allow super_admin in user_profiles.role for this function
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('company_owner', 'staff_member', 'admin', 'expert', 'super_admin'));

CREATE OR REPLACE FUNCTION create_super_admin_profile(
  user_id UUID,
  user_email TEXT,
  user_full_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    user_id,
    user_email,
    user_full_name,
    'super_admin'
  )
  ON CONFLICT (id) DO UPDATE SET
    role = 'super_admin',
    email = user_email,
    full_name = user_full_name,
    updated_at = NOW();
END;
$$;

-- ========== is_admin_user ==========
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$;

-- ========== is_message_read_by_user ==========
-- message_reads table (if not exists) for per-user read tracking
CREATE TABLE IF NOT EXISTS message_reads (
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_reads_message ON message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id);

CREATE OR REPLACE FUNCTION is_message_read_by_user(p_message_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM message_reads
    WHERE message_id = p_message_id AND user_id = p_user_id
  );
END;
$$;

-- ========== is_super_admin ==========
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM user_profiles
  WHERE id = auth.uid()
  LIMIT 1;

  RETURN COALESCE(user_role = 'super_admin', false);
END;
$$;

-- ========== mark_message_read ==========
CREATE OR REPLACE FUNCTION mark_message_read(p_message_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO message_reads (message_id, user_id)
  VALUES (p_message_id, p_user_id)
  ON CONFLICT (message_id, user_id) DO NOTHING;
END;
$$;

-- ========== notify_admins_new_application (trigger) ==========
CREATE OR REPLACE FUNCTION notify_admins_new_application()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_record RECORD;
BEGIN
  IF NEW.status <> 'requested' THEN
    RETURN NEW;
  END IF;

  FOR admin_record IN
    SELECT id FROM user_profiles WHERE role = 'admin'
  LOOP
    INSERT INTO notifications (user_id, title, type)
    VALUES (
      admin_record.id,
      'New Application Request',
      'application_update'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_admins_new_application_trigger ON applications;
CREATE TRIGGER notify_admins_new_application_trigger
  AFTER INSERT ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_admins_new_application();

-- ========== notify_expert_on_assignment_insert (trigger) ==========
CREATE OR REPLACE FUNCTION notify_expert_on_assignment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_profile RECORD;
  expert_profile RECORD;
BEGIN
  IF NEW.assigned_expert_id IS NOT NULL THEN
    SELECT full_name, email INTO owner_profile
    FROM user_profiles
    WHERE id = NEW.company_owner_id;

    SELECT id, full_name, email INTO expert_profile
    FROM user_profiles
    WHERE id = NEW.assigned_expert_id;

    IF expert_profile.id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, message, type, icon_type)
      VALUES (
        NEW.assigned_expert_id,
        'New Application Assigned',
        'You have been assigned to review application "' || NEW.application_name || '" (' || NEW.state || ') for ' || COALESCE(owner_profile.full_name, owner_profile.email, 'an owner') || '.',
        'application_update',
        'document'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_expert_on_assignment_insert_trigger ON applications;
CREATE TRIGGER notify_expert_on_assignment_insert_trigger
  AFTER INSERT ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_expert_on_assignment_insert();

-- ========== notify_expert_on_assignment_update (REMOVED - duplicate of notify_expert_when_assigned) ==========
-- Previously created a second notification when admin assigned expert. Dropped so experts get only one.

-- ========== notify_expert_on_document_submitted (trigger) ==========
CREATE OR REPLACE FUNCTION notify_expert_on_document_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expert_id UUID;
BEGIN
  IF (OLD.status = 'draft' OR OLD.status = 'rejected') AND NEW.status = 'pending' THEN
    SELECT assigned_expert_id INTO expert_id
    FROM applications
    WHERE id = NEW.application_id;

    IF expert_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, type)
      VALUES (
        expert_id,
        'Document Submitted for Review',
        'application_update'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_expert_on_document_submitted_trigger ON application_documents;
CREATE TRIGGER notify_expert_on_document_submitted_trigger
  AFTER UPDATE ON application_documents
  FOR EACH ROW
  EXECUTE FUNCTION notify_expert_on_document_submitted();

-- ========== notify_owner_on_application_approval (trigger) ==========
CREATE OR REPLACE FUNCTION notify_owner_on_application_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status = 'requested' AND NEW.assigned_expert_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, message, type, icon_type)
    VALUES (
      NEW.company_owner_id,
      'Application Approved',
      'Your application "' || NEW.application_name || '" (' || NEW.state || ') has been approved and is now in progress.',
      'application_update',
      'check'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_owner_on_application_approval_trigger ON applications;
CREATE TRIGGER notify_owner_on_application_approval_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_owner_on_application_approval();

-- ========== applications.revision_reason (for notify_owner_on_revision_needed) ==========
ALTER TABLE applications ADD COLUMN IF NOT EXISTS revision_reason TEXT;

-- ========== notify_owner_on_revision_needed (trigger) ==========
CREATE OR REPLACE FUNCTION notify_owner_on_revision_needed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'needs_revision' AND OLD.status = 'under_review' AND NEW.revision_reason IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, message, type, icon_type)
    VALUES (
      NEW.company_owner_id,
      'Application Needs Revision',
      'Your application "' || NEW.application_name || '" (' || NEW.state || ') needs revision. Reason: ' || NEW.revision_reason,
      'application_update',
      'warning'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_owner_on_revision_needed_trigger ON applications;
CREATE TRIGGER notify_owner_on_revision_needed_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_owner_on_revision_needed();

-- ========== trigger_calculate_progress_on_document (trigger) ==========
CREATE OR REPLACE FUNCTION trigger_calculate_progress_on_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM calculate_application_progress(NEW.application_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM calculate_application_progress(OLD.application_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_calculate_progress_on_document_trigger ON application_documents;
CREATE TRIGGER trigger_calculate_progress_on_document_trigger
  AFTER INSERT OR DELETE ON application_documents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_calculate_progress_on_document();

-- ========== trigger_calculate_progress_on_step (trigger) ==========
CREATE OR REPLACE FUNCTION trigger_calculate_progress_on_step()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND (OLD.is_completed != NEW.is_completed)) OR TG_OP = 'INSERT' THEN
    PERFORM calculate_application_progress(NEW.application_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_calculate_progress_on_step_trigger ON application_steps;
CREATE TRIGGER trigger_calculate_progress_on_step_trigger
  AFTER INSERT OR UPDATE ON application_steps
  FOR EACH ROW
  EXECUTE FUNCTION trigger_calculate_progress_on_step();

-- ========== update_demo_user_password ==========
CREATE OR REPLACE FUNCTION update_demo_user_password(email_address TEXT, password_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgcrypto
AS $$
DECLARE
  encrypted_pw TEXT;
  updated_count INTEGER;
BEGIN
  encrypted_pw := crypt(password_text, gen_salt('bf', 10));

  UPDATE auth.users
  SET
    encrypted_password = encrypted_pw,
    updated_at = NOW()
  WHERE email = LOWER(TRIM(email_address));

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RETURN updated_count > 0;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error updating password for %: %', email_address, SQLERRM;
    RETURN FALSE;
END;
$$;

-- ========== auto_review_on_100_percent (trigger) ==========
CREATE OR REPLACE FUNCTION auto_review_on_100_percent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_profile RECORD;
  application_name TEXT;
  app_state TEXT;
BEGIN
  IF NEW.progress_percentage = 100
     AND OLD.progress_percentage < 100
     AND OLD.status = 'in_progress'
     AND NEW.assigned_expert_id IS NOT NULL THEN

    NEW.status := 'under_review';
    NEW.submitted_date := CURRENT_DATE;

    application_name := NEW.application_name;
    app_state := NEW.state;

    INSERT INTO notifications (user_id, title, message, type, icon_type)
    VALUES (
      NEW.assigned_expert_id,
      'Application Ready for Review',
      'Application "' || application_name || '" (' || app_state || ') has reached 100% completion and is ready for your review.',
      'application_update',
      'document'
    );

    SELECT full_name, email INTO owner_profile
    FROM user_profiles
    WHERE id = NEW.company_owner_id;

    INSERT INTO notifications (user_id, title, message, type, icon_type)
    VALUES (
      NEW.company_owner_id,
      'Application Submitted for Review',
      'Your application "' || application_name || '" (' || app_state || ') has been submitted for expert review.',
      'application_update',
      'check'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_review_on_100_percent_trigger ON applications;
CREATE TRIGGER auto_review_on_100_percent_trigger
  BEFORE UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION auto_review_on_100_percent();

-- ========== notify_admin_on_application_submission (REMOVED - duplicate of notify_admins_new_application) ==========
-- Previously created a second notification per admin on new application. Dropped so admins get only one notification.
