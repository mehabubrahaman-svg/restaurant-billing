import type { TableStatus } from '@restroos/domain';

export interface FloorAreaRecord {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

export interface TableRecord {
  id: string;
  floorAreaId: string;
  label: string;
  seats: number;
  shape: 'SQUARE' | 'ROUND' | 'RECT' | 'BOOTH';
  posX: number;
  posY: number;
  status: TableStatus;
  currentOrderId: string | null;
  qrToken: string | null;
  isActive: boolean;
  version: number;
}

export interface FloorRepository {
  areas(branchId: string): FloorAreaRecord[];
  area(branchId: string, id: string): FloorAreaRecord | undefined;
  insertArea(branchId: string, record: FloorAreaRecord, at: Date): void;
  updateArea(branchId: string, record: FloorAreaRecord, at: Date): void;

  tables(branchId: string): TableRecord[];
  table(branchId: string, id: string): TableRecord | undefined;
  tableIdByLabel(branchId: string, label: string): string | undefined;
  /** By QR token, for guests scanning a table QR. Active tables only. */
  tableByQrToken(token: string): (TableRecord & { branchId: string }) | undefined;
  insertTable(branchId: string, record: TableRecord, at: Date): void;
  /** Version-checked: stored version must be `record.version - 1`. */
  updateTable(branchId: string, record: TableRecord, at: Date): void;
}
