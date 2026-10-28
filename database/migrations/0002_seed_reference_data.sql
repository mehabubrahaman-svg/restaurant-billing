-- =============================================================================
-- Reference data that is identical for every installation.
-- Organisation-scoped data (roles, chart of accounts, tax groups) is created by
-- the first-run setup wizard from templates in packages/domain/src/templates.
-- =============================================================================

-- Units of measure. to_base_milli = milli-units of base per 1 unit.
INSERT INTO units (id, code, name, base_code, to_base_milli) VALUES
  ('unit-g',     'g',     'Gram',       'g',  1000),
  ('unit-kg',    'kg',    'Kilogram',   'g',  1000000),
  ('unit-ml',    'ml',    'Millilitre', 'ml', 1000),
  ('unit-l',     'l',     'Litre',      'ml', 1000000),
  ('unit-pc',    'pc',    'Piece',      'pc', 1000),
  ('unit-dozen', 'dozen', 'Dozen',      'pc', 12000),
  ('unit-tray',  'tray',  'Tray (30)',  'pc', 30000);

-- Permission catalogue. Code format: <module>.<action>[.<scope>]
INSERT INTO permissions (id, code, module, description) VALUES
  -- dashboard / admin
  ('perm-001','dashboard.view',            'admin',     'View owner dashboard'),
  ('perm-002','users.manage',              'admin',     'Create/edit/deactivate users'),
  ('perm-003','roles.manage',              'admin',     'Edit roles and permissions'),
  ('perm-004','settings.manage',           'admin',     'Edit restaurant, tax, printer settings'),
  ('perm-005','floor.manage',              'admin',     'Edit floor areas and table layout'),
  ('perm-006','menu.manage',               'admin',     'Create/edit menu, prices, recipes'),
  ('perm-007','audit.view',                'admin',     'View audit trail'),
  ('perm-008','backup.manage',             'admin',     'Run and restore backups'),
  -- tables & orders
  ('perm-010','tables.view',               'orders',    'View floor plan'),
  ('perm-011','tables.update_status',      'orders',    'Mark table cleaning/reserved/available'),
  ('perm-012','orders.create',             'orders',    'Open orders and add items'),
  ('perm-013','orders.update',             'orders',    'Change quantity/notes before firing'),
  ('perm-014','orders.fire_kot',           'orders',    'Send KOT to kitchen'),
  ('perm-015','orders.item_cancel',        'orders',    'Cancel an item already fired'),
  ('perm-016','orders.cancel',             'orders',    'Cancel a whole order'),
  ('perm-017','orders.transfer_table',     'orders',    'Move/merge tables'),
  ('perm-018','reservations.manage',       'orders',    'Manage reservations'),
  -- kitchen
  ('perm-020','kds.view',                  'kitchen',   'View kitchen display'),
  ('perm-021','kds.update_status',         'kitchen',   'Accept/cook/ready KOTs'),
  ('perm-022','kds.assign_chef',           'kitchen',   'Assign KOTs to chefs'),
  ('perm-023','menu.toggle_availability',  'kitchen',   'Mark items out of stock (86)'),
  -- billing
  ('perm-030','billing.create',            'billing',   'Generate bill for an order'),
  ('perm-031','billing.collect_payment',   'billing',   'Record payments'),
  ('perm-032','billing.discount',          'billing',   'Apply discount up to role limit'),
  ('perm-033','billing.discount_override', 'billing',   'Approve discount above limit'),
  ('perm-034','billing.complimentary',     'billing',   'Mark items/bills complimentary'),
  ('perm-035','billing.reprint',           'billing',   'Reprint bill'),
  ('perm-036','billing.cancel',            'billing',   'Cancel a bill'),
  ('perm-037','billing.refund',            'billing',   'Approve refunds / credit notes'),
  ('perm-038','billing.credit_sale',       'billing',   'Bill to credit customer'),
  ('perm-039','cash.shift_manage',         'billing',   'Open/close cash drawer shift'),
  -- customers
  ('perm-040','customers.view',            'crm',       'View customers'),
  ('perm-041','customers.manage',          'crm',       'Create/edit customers'),
  ('perm-042','loyalty.adjust',            'crm',       'Manually adjust loyalty points'),
  -- inventory
  ('perm-050','inventory.view',            'inventory', 'View stock'),
  ('perm-051','inventory.manage_items',    'inventory', 'Create/edit inventory items'),
  ('perm-052','inventory.adjust',          'inventory', 'Post adjustments/wastage'),
  ('perm-053','inventory.count',           'inventory', 'Record opening/closing counts'),
  -- vendors & purchasing
  ('perm-060','vendors.view',              'purchase',  'View vendors'),
  ('perm-061','vendors.manage',            'purchase',  'Create/edit vendors'),
  ('perm-062','po.create',                 'purchase',  'Create purchase orders'),
  ('perm-063','po.approve',                'purchase',  'Approve purchase orders'),
  ('perm-064','grn.post',                  'purchase',  'Receive goods (post GRN)'),
  ('perm-065','vendor_payments.create',    'purchase',  'Record vendor payments'),
  -- accounts
  ('perm-070','accounts.view',             'accounts',  'View ledgers'),
  ('perm-071','accounts.journal',          'accounts',  'Post manual journal entries'),
  ('perm-072','expenses.manage',           'accounts',  'Record expenses'),
  -- reports
  ('perm-080','reports.sales',             'reports',   'Sales & tax reports'),
  ('perm-081','reports.inventory',         'reports',   'Inventory reports'),
  ('perm-082','reports.financial',         'reports',   'P&L, balance sheet, cash flow'),
  ('perm-083','reports.export',            'reports',   'Export PDF/Excel/CSV'),
  -- sync
  ('perm-090','sync.manage',               'sync',      'Configure and resolve cloud sync');
