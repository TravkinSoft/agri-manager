# Warehouse Access Management

Status: `BACKLOG_ONLY`

Source: `TZ-217`

## Current rule

Until a separate owner-approved task is created, all active company warehouses are visible to Warehousekeeper, Weighbridge Operator and Agronomist. Company Admin also sees archived warehouses. Visibility does not grant stock-movement permissions.

## Future scope

Company Admin may eventually configure warehouse access:

- by role;
- by individual user;
- read-only;
- stock movements;
- inventory counting.

This requires an explicit access contract, RLS design, API guards and a management UI. TZ-217 does not add permission tables, ACL rules or access-management screens.
