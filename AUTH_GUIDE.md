# Authentication System Guide

## Overview

This application uses Supabase Auth for complete user authentication with email/password + OTP verification, role-based access control, and session management.

## Authentication Flow

### 1. Registration Flow
1. User visits `/auth/register`
2. Enters email and password (minimum 6 characters)
3. Confirms password
4. Clicks "Create Account"
5. Receives 6-digit OTP code via email
6. Enters verification code
7. Account is confirmed
8. Automatically redirected to `/dashboard`

### 2. Login Flow
1. User visits `/auth/login` (or is redirected when accessing protected routes)
2. Enters email and password
3. Clicks "Sign In"
4. Redirected to `/dashboard`

### 3. Password Reset Flow
1. User clicks "Forgot password?" on login page
2. Enters email address
3. Receives reset link via email
4. Clicks link and enters new password
5. Redirected to dashboard

### 4. Session Management
- Sessions are automatically persisted across page reloads
- Session is stored securely using Supabase Auth
- Auto-login if valid session exists
- Logout clears session and redirects to `/auth/login`

## User Roles

The system supports 4 roles with different permission levels:

### Admin
- **Full access** to all features
- Can view and manage all users
- Can modify assistant settings
- Can access all data

### Agronomist (Default Role)
- Can create and manage operations
- Full access to AI Assistant
- Can manage agronomy data (fields, crops, seasons)
- Cannot change assistant settings
- Cannot view users page

### Specialist
- Can view operations
- Can execute and complete tasks
- Can chat with AI Assistant (read-only recommendations)
- Cannot create operations
- Limited data access

### Warehouse
- Can view and manage warehouses
- Can manage inventory transactions
- No access to AI Assistant
- No access to agronomy features

## Route Protection

All app routes are protected and require authentication:

### Protected Routes
- `/dashboard` - Main dashboard
- `/fields` - Field management
- `/crop-structure` - Crop planning
- `/operations` - Operations tracking
- `/warehouses` - Warehouse and inventory
- `/specialist` - AI Assistant
- `/settings` - Application settings
- `/users` - User management (admin only)
- `/analytics` - Analytics dashboard
- `/field-history` - Field history
- `/references` - Reference data

### Public Routes
- `/auth/login` - Login page
- `/auth/register` - Registration page
- `/auth/forgot-password` - Password reset request
- `/auth/reset-password` - Password reset form
- `/auth/callback` - OAuth callback handler

### Redirect Behavior
- Unauthenticated users accessing protected routes → `/auth/login`
- Authenticated users visiting `/` → `/dashboard`
- Non-admin users accessing `/users` → Access denied message

## Database Structure

### Profiles Table
```sql
profiles (
  id uuid PRIMARY KEY (references auth.users),
  email text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'agronomist',
  created_at timestamptz,
  updated_at timestamptz
)
```

### Automatic Profile Creation
When a user registers, a trigger automatically creates their profile:
- Default role: `agronomist`
- Email copied from auth.users
- Timestamps set automatically

## Row Level Security (RLS)

All data tables enforce RLS to isolate user data:

### User Data Isolation
- Users can only view and modify their own data
- `auth.uid()` is used to enforce ownership
- Reference tables (crops, products) are shared or user-specific
- Chat history is isolated per user

### Policy Structure
Each table has policies for:
- **SELECT**: Users can read own data
- **INSERT**: Users can create own data
- **UPDATE**: Users can modify own data
- **DELETE**: Users can delete own data

## Implementation Files

### Core Auth Files
- `/lib/contexts/auth-context.tsx` - Auth context provider
- `/components/auth/protected-route.tsx` - Route protection wrapper
- `/app/layout.tsx` - Root layout with auth providers

### Auth Pages
- `/app/auth/login/page.tsx` - Login UI
- `/app/auth/register/page.tsx` - Registration + OTP verification
- `/app/auth/forgot-password/page.tsx` - Password reset request
- `/app/auth/reset-password/page.tsx` - Password reset form
- `/app/auth/callback/route.ts` - OAuth callback handler

### Database Migrations
- `create_profiles_and_roles.sql` - Profile table and auto-creation trigger
- `update_rls_policies_for_auth.sql` - RLS policies for all tables

### UI Components
- `/components/layout/header.tsx` - User menu with role badge and logout

## Usage Examples

### Check User Authentication
```typescript
import { useAuth } from '@/lib/contexts/auth-context';

function MyComponent() {
  const { user, profile, loading } = useAuth();

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Not authenticated</div>;

  return <div>Welcome {user.email}!</div>;
}
```

### Check User Role
```typescript
import { useAuth } from '@/lib/contexts/auth-context';

function AdminOnlyFeature() {
  const { profile } = useAuth();

  if (profile?.role !== 'admin') {
    return <div>Access denied</div>;
  }

  return <div>Admin content</div>;
}
```

### Logout User
```typescript
import { useAuth } from '@/lib/contexts/auth-context';

function LogoutButton() {
  const { signOut } = useAuth();

  return (
    <button onClick={signOut}>
      Logout
    </button>
  );
}
```

## Security Features

### Password Requirements
- Minimum 6 characters
- Confirmation required during registration
- Secure hashing by Supabase Auth

### Email Verification
- 6-digit OTP code sent to email
- Code expiration (60 seconds resend limit)
- Resend functionality available

### Session Security
- HTTP-only cookies for session storage
- Secure token handling by Supabase
- Automatic session refresh
- Session expiration handling

### Data Isolation
- RLS policies enforce user data boundaries
- No cross-user data access
- Secure API endpoints with auth checks

## Configuration

### Supabase Settings
Environment variables in `.env`:
```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Email Templates
Configure in Supabase Dashboard → Authentication → Email Templates:
- Confirmation email (with OTP code)
- Password reset email
- Email change confirmation

### Site URL
Set in Supabase Dashboard → Authentication → URL Configuration:
- Site URL: `https://your-domain.com`
- Redirect URLs: `https://your-domain.com/auth/callback`

## Testing the Auth System

### Test Registration
1. Open `/auth/register`
2. Use a real email address (for OTP)
3. Check email for verification code
4. Complete registration
5. Verify redirect to dashboard
6. Check profile in header (should show "agronomist" role)

### Test Login/Logout
1. Logout using header menu
2. Verify redirect to `/auth/login`
3. Login with credentials
4. Verify redirect to dashboard
5. Verify session persists after page reload

### Test Route Protection
1. Logout from the app
2. Try to access `/dashboard` directly
3. Verify redirect to `/auth/login`
4. Login and verify redirect back to intended page

### Test Password Reset
1. Click "Forgot password?" on login
2. Enter email
3. Check email for reset link
4. Click link
5. Set new password
6. Verify login with new password

### Test User Management
1. Login as admin user
2. Visit `/users` page
3. Verify user list displays
4. Logout and login as non-admin
5. Visit `/users` page
6. Verify access denied message

## Admin Setup

To create the first admin user:

1. Register normally through `/auth/register`
2. Use Supabase Dashboard or SQL to update role:
```sql
UPDATE profiles
SET role = 'admin'
WHERE email = 'admin@example.com';
```

Or use the SQL Editor in Supabase Dashboard.

## Troubleshooting

### User can't receive OTP email
- Check Supabase email rate limits
- Verify email configuration in Supabase Dashboard
- Check spam folder
- Ensure valid email address

### Session not persisting
- Clear browser cookies
- Check browser privacy settings
- Verify environment variables are set
- Check for CORS issues

### Access denied errors
- Verify user is authenticated
- Check user role matches requirement
- Review RLS policies in database
- Check browser console for errors

### Build errors
- Run `npm run build` to check for TypeScript errors
- Verify all imports are correct
- Check that auth context is properly wrapped in layout

## Next Steps

### Future Enhancements
- [ ] Add OAuth providers (Google, GitHub)
- [ ] Implement email change flow
- [ ] Add user profile editing
- [ ] Create admin panel for role management
- [ ] Add activity logging
- [ ] Implement session timeout warnings
- [ ] Add multi-factor authentication (MFA)
- [ ] Create user invitation system
- [ ] Add user deactivation/deletion
- [ ] Implement audit logs

### Role Permissions
Currently roles are stored but not fully enforced in the UI. Next steps:
- Add permission checks to components
- Hide/disable features based on role
- Create role-based navigation
- Implement feature flags per role
