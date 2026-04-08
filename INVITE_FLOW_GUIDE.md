# User Invite Flow Documentation

## Overview

This system implements a secure, invite-based user onboarding flow where admin users can invite team members to join their company. Invited users automatically join the inviter's company and cannot create separate companies.

## Components

### 1. Edge Function: `invite-user`

**Location:** `supabase/functions/invite-user/index.ts`

**Purpose:** Handles user invitation securely using Supabase Admin API

**Endpoint:** `{SUPABASE_URL}/functions/v1/invite-user`

**Authentication:** Requires valid Supabase anon key

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "role": "agronomist|specialist|warehouse|admin",
  "company_id": "uuid-of-company"
}
```

**Response:**
```json
{
  "success": true,
  "user": { /* user object */ },
  "message": "Invitation sent successfully"
}
```

### 2. Profile Creation Trigger

**Function:** `handle_new_user()`

**Trigger:** `on_auth_user_created` (AFTER INSERT on auth.users)

**Behavior:**
- Checks if user has `raw_user_meta_data->>'invited_by_company'`
- **If invited:**
  - Joins existing company (from metadata)
  - Gets assigned role (from metadata)
  - `is_owner` = false
- **If not invited (new signup):**
  - Creates new company
  - Becomes company owner
  - `is_owner` = true

### 3. Auth Callback Handler

**Location:** `app/auth/callback/route.ts`

**Purpose:** Handles OAuth callbacks and redirects invited users to password setup

**Behavior:**
- Exchanges code for session
- If user was invited (`type=invite` or has `invited_by_company` metadata):
  - Redirects to `/auth/reset-password`
- Otherwise:
  - Redirects to `/dashboard`

### 4. Users Page

**Location:** `app/(dashboard)/users/page.tsx`

**Access:** Admin role only

**Features:**
- Lists all users in the company
- Invite button opens dialog
- Invite form collects:
  - Email address
  - Role (agronomist/specialist/warehouse/admin)
- Calls Edge Function to send invitation

## Invite Flow Step-by-Step

### 1. Admin Sends Invitation

1. Admin logs in and navigates to Users page
2. Clicks "Invite User" button
3. Enters invitee's email and selects role
4. Clicks "Send Invitation"
5. Frontend calls Edge Function with company_id, email, role
6. Edge Function uses Supabase Admin API to send invite email

### 2. User Receives Email

The invite email contains:
- Link to accept invitation
- Link format: `{APP_URL}/auth/callback?code={CODE}&type=invite`

**Email Configuration:**
- Sent by Supabase Auth
- Uses Supabase's default email templates
- Can be customized in Supabase Dashboard > Authentication > Email Templates

### 3. User Clicks Invite Link

1. Link opens `/auth/callback` route
2. Callback handler:
   - Exchanges code for session
   - Checks if user was invited
   - Redirects to `/auth/reset-password`

### 4. User Sets Password

1. User sees "Set Your Password" page
2. Enters new password (minimum 6 characters)
3. Confirms password
4. Clicks "Update Password"
5. Password is set using `supabase.auth.updateUser()`
6. Redirects to `/dashboard`

### 5. Profile Created Automatically

1. When user's auth record is created, `on_auth_user_created` trigger fires
2. Trigger function:
   - Reads `raw_user_meta_data->>'invited_by_company'`
   - Reads `raw_user_meta_data->>'role'`
   - Creates profile linked to inviter's company
   - Sets `is_owner = false`

### 6. User Accesses Dashboard

1. User logs in and sees company data
2. All fields, warehouses, operations are shared across company
3. Role-based access is enforced based on assigned role

## Testing the Invite Flow

### Prerequisites

1. **Admin User Exists:**
   ```sql
   -- Current admin user: aimbeks@gmail.com
   SELECT email, role, is_owner FROM profiles WHERE role = 'admin';
   ```

2. **Email Delivery Configured:**
   - Check Supabase Dashboard > Project Settings > Auth
   - Verify SMTP settings or use Supabase's built-in email service
   - For development, check Supabase Dashboard > Authentication > Logs

3. **Edge Function Deployed:**
   ```bash
   # Function should be deployed
   # Check with: list edge functions in Supabase dashboard
   ```

### Test Steps

#### Step 1: Send Invitation

1. Log in as admin (aimbeks@gmail.com)
2. Navigate to Users page
3. Click "Invite User"
4. Enter test email (e.g., testuser@example.com)
5. Select role (e.g., "Agronomist")
6. Click "Send Invitation"
7. **Verify:** Toast notification shows "Invitation sent"

#### Step 2: Check Email Delivery

**Option A: Real Email**
- Check inbox of invited email
- Look for "You have been invited" email from Supabase

**Option B: Development (Supabase Logs)**
1. Go to Supabase Dashboard
2. Authentication > Users
3. Find invited user
4. Check `invited_at` timestamp
5. Go to Authentication > Logs
6. Look for invite email event

**Common Issues:**
- **No email received:** Check SMTP settings in Supabase Dashboard
- **Email goes to spam:** Add Supabase sender to safe list
- **Email disabled:** Enable email in Supabase Auth settings

#### Step 3: Accept Invitation

1. Click invite link from email
2. **Expected:** Redirects to password setup page
3. **Verify:** URL is `/auth/reset-password`

#### Step 4: Set Password

1. Enter password (min 6 characters)
2. Confirm password
3. Click "Update Password"
4. **Expected:** Redirects to dashboard
5. **Verify:** User is logged in

#### Step 5: Verify Profile Creation

```sql
-- Check that profile was created with correct company_id
SELECT
  email,
  role,
  company_id,
  is_owner
FROM profiles
WHERE email = 'testuser@example.com';

-- Should show:
-- email: testuser@example.com
-- role: agronomist (or selected role)
-- company_id: same as admin's company_id
-- is_owner: false
```

#### Step 6: Verify Data Access

1. Log in as invited user
2. Navigate to Fields page
3. **Expected:** See all company fields (same as admin sees)
4. Navigate to Warehouses page
5. **Expected:** See all company warehouses
6. Try to access Users page
7. **Expected:** Access denied (unless role is admin)

### Verification Queries

```sql
-- 1. Check all users in company
SELECT
  p.email,
  p.role,
  p.is_owner,
  u.invited_at,
  u.confirmed_at,
  c.name as company_name
FROM profiles p
JOIN auth.users u ON u.id = p.id
JOIN companies c ON c.id = p.company_id
ORDER BY u.created_at DESC;

-- 2. Verify company data is shared
SELECT
  'fields' as table_name,
  company_id,
  COUNT(*) as record_count
FROM fields
GROUP BY company_id
UNION ALL
SELECT
  'warehouses' as table_name,
  company_id,
  COUNT(*) as record_count
FROM warehouses
GROUP BY company_id;

-- 3. Check for orphaned data
SELECT
  'orphaned_profiles' as issue,
  COUNT(*) as count
FROM profiles
WHERE company_id NOT IN (SELECT id FROM companies)
UNION ALL
SELECT
  'users_without_profiles' as issue,
  COUNT(*) as count
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id);
```

## Security Features

1. **Admin-Only Invites:** Only users with `role = 'admin'` can access invite functionality
2. **Company Isolation:** Invited users automatically join inviter's company
3. **No Bypass:** Cannot manually set company_id during signup
4. **Server-Side Validation:** Edge Function validates all parameters
5. **RLS Policies:** Database-level security ensures data isolation

## Troubleshooting

### Email Not Sending

**Check:**
1. Supabase Dashboard > Authentication > Email Templates
2. Verify "Invite user" template is enabled
3. Check SMTP configuration
4. Review Authentication logs

**Debug Query:**
```sql
-- Check if invite was created
SELECT
  id,
  email,
  invited_at,
  confirmation_sent_at,
  raw_user_meta_data
FROM auth.users
WHERE email = 'invitee@example.com';
```

### Invited User Gets Wrong Company

**Check:**
```sql
-- Verify metadata was set correctly
SELECT
  email,
  raw_user_meta_data->>'invited_by_company' as invited_company,
  raw_user_meta_data->>'role' as invited_role
FROM auth.users
WHERE email = 'invitee@example.com';
```

**Fix:**
If metadata is missing, the Edge Function may have failed. Check logs.

### Profile Not Created

**Check:**
```sql
-- Verify trigger exists and is enabled
SELECT
  tgname,
  tgenabled
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Check trigger function
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'handle_new_user';
```

### User Can't Log In After Accepting Invite

**Common Issues:**
1. Password not set properly
2. Email confirmation required (should be disabled)
3. Account locked

**Check:**
```sql
SELECT
  email,
  confirmed_at,
  encrypted_password IS NOT NULL as has_password,
  banned_until,
  deleted_at
FROM auth.users
WHERE email = 'invitee@example.com';
```

## Configuration Checklist

- [ ] Edge Function `invite-user` deployed
- [ ] Trigger `on_auth_user_created` exists and enabled
- [ ] Admin user exists with `role = 'admin'`
- [ ] Email delivery configured in Supabase
- [ ] Email confirmation disabled (for smoother flow)
- [ ] RLS policies allow company data access
- [ ] Callback route handles invited users
- [ ] Password reset page works

## API Reference

### Edge Function Request

```typescript
const response = await fetch(`${supabaseUrl}/functions/v1/invite-user`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${anonKey}`,
  },
  body: JSON.stringify({
    email: 'newuser@example.com',
    role: 'agronomist',
    company_id: 'company-uuid',
  }),
});
```

### Error Responses

```json
// Missing fields
{
  "error": "Missing required fields: email, role, company_id"
}

// Invalid email
{
  "error": "Invalid email format"
}

// User already exists
{
  "error": "User already registered"
}

// Server error
{
  "error": "Failed to invite user",
  "details": { /* error object */ }
}
```
