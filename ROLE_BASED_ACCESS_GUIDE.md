# Role-Based Access Control Guide

## Overview

The AgriManager system implements comprehensive role-based access control with specialized interfaces for each user type. Users select their role during registration, which determines their available features, navigation, and UI.

## User Roles & Capabilities

### Admin
**Full System Access**

Navigation:
- Dashboard
- Fields
- Crop Structure
- Field History
- Operations (with Active/Completed tabs)
- Warehouses
- Analytics
- AI Assistant (full access with operation drafts)
- References
- Users (admin only)
- Settings (admin only)
- Import

Capabilities:
- Complete system administration
- User management via `/users` page
- Assistant configuration via `/specialist/settings`
- All agronomy features
- All warehouse features
- Full AI Assistant with operation creation

### Agronomist (Default)
**Agricultural Management**

Navigation:
- Dashboard
- Fields
- Crop Structure
- Field History
- Operations (with Active/Completed tabs)
- Warehouses
- Analytics
- AI Assistant (full access)
- References
- Import

Capabilities:
- Create and manage fields, crops, seasons
- Create and manage operations
- Assign operations to specialists
- Full AI Assistant access with operation draft creation
- View and manage warehouse data
- Access analytics and reports
- Import farm data
- Cannot access user management
- Cannot modify assistant settings

### Specialist
**Task Execution Interface**

Navigation:
- Dashboard
- My Tasks (specialized interface at `/tasks`)
- AI Assistant (read-only mode)

Task Interface (`/tasks`):
- **My Tasks Tab**: Active assigned operations
  - View operation details (type, field, crop, date)
  - Accept tasks (Planned → Accepted)
  - Start tasks (Accepted → In Progress)
  - Complete tasks (In Progress → Completed)
  - Track timestamps for each action

- **Completed Tab**: Historical completed tasks
  - View completion timestamps
  - Review past work

AI Assistant Access:
- Read-only chat mode
- Can ask questions and get recommendations
- **Cannot create operation drafts**
- Operation drafts show informational message instead
- Directed to contact agronomist for operation creation

Restrictions:
- Cannot create new operations
- Cannot access agronomy management (fields, crops, etc.)
- Cannot access warehouses
- Cannot access analytics
- Cannot access settings

### Warehouse
**Inventory Management Interface**

Navigation:
- Dashboard
- Warehouses
- Inventory (specialized interface at `/inventory`)

Inventory Interface (`/inventory`):
- **Current Stock Tab**:
  - View stock levels by warehouse
  - Product names and types
  - Quantity with units
  - Real-time inventory status

- **Transactions Tab**:
  - View transaction history
  - Incoming (green badge) and Outgoing (orange badge) transactions
  - Transaction dates and quantities
  - Notes and details

Restrictions:
- **No AI Assistant access** (blocked completely)
- Cannot access agronomy features
- Cannot create operations
- Cannot access fields, crops, or analytics

## Role Selection & Registration

### Registration Flow

1. User visits `/auth/register`
2. Enters email and password
3. **Selects role** from dropdown:
   - Agronomist (default)
   - Specialist
   - Warehouse
   - (Admin is NOT available for self-selection)
4. Receives 6-digit OTP verification code via email
5. Enters verification code
6. Account created with selected role
7. Redirected to dashboard

### Role Assignment

- Role is selected during registration
- Stored in `profiles` table
- **Admin role** can only be assigned manually via database:
  ```sql
  UPDATE profiles SET role = 'admin' WHERE email = 'admin@example.com';
  ```

## Operations & Task System

### Operation Statuses

Operations support 4 statuses for task workflow:

1. **Planned** (default)
   - Operation created by agronomist
   - Not yet assigned or accepted
   - Visible in Active Operations

2. **Accepted**
   - Specialist has accepted the task
   - `accepted_at` timestamp recorded
   - Ready to start work

3. **In Progress**
   - Specialist has started the task
   - `started_at` timestamp recorded
   - Actively being worked on

4. **Completed**
   - Task finished by specialist
   - `completed_at` timestamp recorded
   - Moved to Completed Operations tab

### Assignment System

Operations table fields:
- `assigned_to`: UUID reference to specialist profile
- `status`: Current task status
- `accepted_at`: Timestamp when accepted
- `started_at`: Timestamp when started
- `completed_at`: Timestamp when completed

### Specialist Workflow

```
1. Agronomist creates operation and assigns to specialist
   ↓
2. Specialist sees task in "My Tasks"
   ↓
3. Specialist clicks "Accept Task" (Planned → Accepted)
   ↓
4. Specialist clicks "Start Task" (Accepted → In Progress)
   ↓
5. Work is performed
   ↓
6. Specialist clicks "Complete Task" (In Progress → Completed)
   ↓
7. Task moves to "Completed Tasks" tab
```

### Operations View (Agronomist/Admin)

Operations page split into tabs:
- **Active Operations**: All non-completed operations
  - Shows status badges (Planned, Accepted, In Progress)
  - Can edit and archive
  - Can reassign

- **Completed Operations**: All finished operations
  - Historical record
  - Completion timestamps
  - Read-only view

## Navigation Visibility

Navigation is dynamically filtered based on user role:

| Page | Admin | Agronomist | Specialist | Warehouse |
|------|-------|------------|------------|-----------|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Fields | ✓ | ✓ | ✗ | ✗ |
| Crop Structure | ✓ | ✓ | ✗ | ✗ |
| Field History | ✓ | ✓ | ✗ | ✗ |
| Operations | ✓ | ✓ | ✗ | ✗ |
| My Tasks | ✗ | ✗ | ✓ | ✗ |
| Warehouses | ✓ | ✓ | ✗ | ✓ |
| Inventory | ✗ | ✗ | ✗ | ✓ |
| Analytics | ✓ | ✓ | ✗ | ✗ |
| AI Assistant | ✓ (full) | ✓ (full) | ✓ (read-only) | ✗ |
| References | ✓ | ✓ | ✗ | ✗ |
| Users | ✓ | ✗ | ✗ | ✗ |
| Settings | ✓ | ✗ | ✗ | ✗ |
| Import | ✓ | ✓ | ✗ | ✗ |

## AI Assistant Access Control

### Full Access (Admin, Agronomist)
- Complete chat interface
- Can create operation drafts
- Operation draft cards visible with:
  - Edit button
  - Confirm button (creates actual operation)
  - Cancel button
- Settings button visible in page header

### Read-Only Access (Specialist)
- Complete chat interface for questions
- Can ask for recommendations
- **Operation drafts disabled**:
  - Draft cards hidden
  - Shows informational message instead
  - Directs to contact agronomist
- No settings button in header
- Page description shows "read-only mode"

### No Access (Warehouse)
- AI Assistant link hidden from navigation
- Page shows access denied message
- Redirects or blocks access

## Database Schema

### Profiles Table
```sql
profiles (
  id uuid PRIMARY KEY (references auth.users),
  email text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'agronomist',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_role CHECK (role IN ('admin', 'agronomist', 'specialist', 'warehouse'))
)
```

### Operations Table (Extended)
```sql
operations (
  id uuid PRIMARY KEY,
  field_id uuid REFERENCES fields,
  crop_structure_id uuid REFERENCES crop_structure,
  operation_type text NOT NULL,
  date date NOT NULL,
  notes text,
  status text DEFAULT 'planned' CHECK (status IN ('planned', 'accepted', 'in_progress', 'completed')),
  assigned_to uuid REFERENCES profiles(id),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  user_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
```

## Row Level Security

### Specialist Access to Operations
Specialists can view operations they are assigned to:

```sql
CREATE POLICY "Users can read own operations"
  ON operations FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR
    auth.uid() = assigned_to
  );
```

### Specialist Can Update Assigned Operations
```sql
CREATE POLICY "Users can update own operations"
  ON operations FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id OR
    auth.uid() = assigned_to
  )
  WITH CHECK (
    auth.uid() = user_id OR
    auth.uid() = assigned_to
  );
```

## Testing Role-Based System

### Test Specialist Role

1. **Register as Specialist**:
   - Go to `/auth/register`
   - Select "Specialist" role
   - Complete registration

2. **Verify Navigation**:
   - Should see: Dashboard, My Tasks, AI Assistant
   - Should NOT see: Fields, Operations, Warehouses, etc.

3. **Test Task Interface**:
   - Go to `/tasks`
   - Verify "My Tasks" and "Completed" tabs
   - No tasks initially (need agronomist to assign)

4. **Test AI Assistant**:
   - Go to `/specialist`
   - Verify read-only message
   - No Settings button
   - Can chat but drafts show info message

### Test Warehouse Role

1. **Register as Warehouse**:
   - Select "Warehouse" role

2. **Verify Navigation**:
   - Should see: Dashboard, Warehouses, Inventory
   - Should NOT see: Fields, Operations, AI Assistant

3. **Test Inventory Interface**:
   - Go to `/inventory`
   - Verify "Current Stock" and "Transactions" tabs
   - See inventory data if available

4. **Verify AI Assistant Blocked**:
   - AI Assistant not in navigation
   - Direct access to `/specialist` shows denial

### Test Task Workflow

1. **As Agronomist**:
   - Create operation
   - Assign to specialist user
   - Set status to "planned"

2. **As Specialist**:
   - View task in "My Tasks"
   - Click "Accept Task"
   - Verify status changes to "accepted"
   - Click "Start Task"
   - Verify status changes to "in_progress"
   - Click "Complete Task"
   - Task moves to "Completed" tab

## Security Considerations

### Role Enforcement
- Role checked on every protected page
- Access denied alerts shown for unauthorized access
- Navigation filtered by role
- RLS policies enforce database-level security

### Role Modification
- Users cannot change their own role
- Only database-level updates can change roles
- No UI for role changes (prevents privilege escalation)

### Operation Assignment
- Only owners and assigned specialists can view operations
- Specialists can update status but not core data
- Timestamps tracked for accountability

## Best Practices

### For Administrators
- Assign specialist role only to field workers
- Assign warehouse role only to inventory staff
- Keep admin role limited to system administrators
- Regularly review user list for role accuracy

### For Agronomists
- Assign operations to appropriate specialists
- Provide clear operation notes
- Monitor task completion in Operations page
- Use Active/Completed tabs to track progress

### For Specialists
- Accept tasks promptly
- Start tasks when beginning work
- Complete tasks when finished
- Use AI Assistant for guidance (read-only)

### For Warehouse Staff
- Keep inventory transactions up to date
- Record all incoming/outgoing items
- Review stock levels regularly
- Maintain accurate product information

## Future Enhancements

Potential improvements:
- [ ] Task notifications for specialists
- [ ] Operation assignment from UI (currently manual)
- [ ] Task reassignment capability
- [ ] Task comments and notes
- [ ] Time tracking per task
- [ ] Task completion reports
- [ ] Inventory alerts and thresholds
- [ ] Role-based dashboard customization
- [ ] Task search and filtering
- [ ] Bulk task assignment
