// Common types used across Ark applications

export interface FileUpload {
  name: string;
  type: string;
  size: number;
  content: ArrayBuffer;
}

export interface ProjectRequirements {
  name: string;
  description: string;
  dataSources: DataSource[];
  features: string[];
}

export interface DataSource {
  name: string;
  type: "csv" | "excel" | "json";
  columns: DataColumn[];
}

export interface DataColumn {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  required: boolean;
  primaryKey?: boolean;
}

export interface BuildStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  message?: string;
  logs?: string[];
}
