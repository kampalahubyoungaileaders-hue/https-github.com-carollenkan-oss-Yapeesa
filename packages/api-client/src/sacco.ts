export type SaccoJson =
  null | boolean | string | SaccoJson[] | { [key: string]: SaccoJson };
export interface SaccoField {
  key: string;
  label: string;
  type: 'text' | 'id' | 'decimal' | 'integer' | 'date' | 'boolean';
  required: boolean;
}
export interface SaccoOperation {
  id: string;
  label: string;
  resource: string;
  fields: SaccoField[];
  target: boolean;
  sub_target: boolean;
  quote: boolean;
}
export interface SaccoCatalog {
  resources: {
    id: string;
    label: string;
    detail: boolean;
    template: boolean;
    page: boolean;
  }[];
  operations: SaccoOperation[];
}
