export interface OperationDraft {
  operation_type: string;
  field_id?: string;
  field_name?: string;
  crop_structure_id?: string;
  crop_id?: string;
  crop_name?: string;
  operation_datetime?: string;
  date: string;
  notes: string;
  metadata?: {
    target?: string;
    product?: string;
    product_id?: string;
    rate?: string;
    rate_per_ha?: string;
    additional_products?: string;
    additional_products_list?: Array<{
      product?: string;
      product_id?: string;
      rate_per_ha?: string;
      role?: string;
      notes?: string;
    }>;
    spray_volume_per_ha?: string;
    total_mixture_volume?: string;
    total_water_volume?: string;
    total_product_volume?: string;
    water_percentage?: string;
    product_percentage?: string;
    mixture_composition?: string;
    equipment?: string;
    equipment_id?: string;
    responsible?: string;
    responsible_id?: string;
    comments?: string;
    [key: string]: any;
  };
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  draft?: OperationDraft;
  timestamp: Date;
}
