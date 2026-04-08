import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

interface FieldData {
  name: string;
  area: number;
}

interface FieldHistoryData {
  field_name: string;
  season: number;
  crop: string;
}

interface CropStructureData {
  field_name: string;
  crop: string;
  area: number;
}

interface ImportData {
  fields: FieldData[];
  field_history: FieldHistoryData[];
  crop_structure: CropStructureData[];
}

export async function POST(request: NextRequest) {
  try {
    const data: ImportData = await request.json();

    const results = {
      fields: 0,
      field_history: 0,
      crop_structure: 0,
      errors: [] as string[],
    };

    // Step 1: Import fields
    if (data.fields && data.fields.length > 0) {
      for (const field of data.fields) {
        try {
          const { error } = await supabase
            .from('fields')
            .insert({
              name: field.name,
              area: field.area,
            });

          if (error) {
            results.errors.push(`Field "${field.name}": ${error.message}`);
          } else {
            results.fields++;
          }
        } catch (err) {
          results.errors.push(`Field "${field.name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    // Get all fields with their IDs for mapping
    const { data: fieldsData, error: fieldsError } = await supabase
      .from('fields')
      .select('id, name');

    if (fieldsError) {
      return NextResponse.json(
        { error: 'Failed to fetch fields', details: fieldsError.message },
        { status: 500 }
      );
    }

    const fieldMap = new Map(fieldsData.map((f) => [f.name, f.id]));

    // Step 2: Import field history
    if (data.field_history && data.field_history.length > 0) {
      for (const history of data.field_history) {
        try {
          const fieldId = fieldMap.get(history.field_name);
          if (!fieldId) {
            results.errors.push(`Field history: Field "${history.field_name}" not found`);
            continue;
          }

          const { error } = await supabase
            .from('field_history')
            .insert({
              field_id: fieldId,
              season: history.season,
              crop: history.crop,
            });

          if (error) {
            results.errors.push(`Field history "${history.field_name}" ${history.season}: ${error.message}`);
          } else {
            results.field_history++;
          }
        } catch (err) {
          results.errors.push(`Field history "${history.field_name}" ${history.season}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    // Get crop IDs for mapping
    const { data: cropsData, error: cropsError } = await supabase
      .from('crops')
      .select('id, name');

    if (cropsError) {
      return NextResponse.json(
        { error: 'Failed to fetch crops', details: cropsError.message },
        { status: 500 }
      );
    }

    const cropMap = new Map(cropsData.map((c) => [c.name.toLowerCase(), c.id]));

    // Get 2025 season ID
    const { data: seasonData, error: seasonError } = await supabase
      .from('seasons')
      .select('id')
      .eq('year', 2025)
      .maybeSingle();

    if (seasonError || !seasonData) {
      return NextResponse.json(
        { error: 'Failed to fetch 2025 season', details: seasonError?.message },
        { status: 500 }
      );
    }

    const season2025Id = seasonData.id;

    // Step 3: Import crop structure for 2025
    if (data.crop_structure && data.crop_structure.length > 0) {
      for (const structure of data.crop_structure) {
        try {
          const fieldId = fieldMap.get(structure.field_name);
          if (!fieldId) {
            results.errors.push(`Crop structure: Field "${structure.field_name}" not found`);
            continue;
          }

          const cropId = cropMap.get(structure.crop.toLowerCase());
          if (!cropId) {
            results.errors.push(`Crop structure: Crop "${structure.crop}" not found`);
            continue;
          }

          const { error } = await supabase
            .from('crop_structure')
            .insert({
              field_id: fieldId,
              season_id: season2025Id,
              crop_id: cropId,
              area: structure.area,
              status: 'planned',
            });

          if (error) {
            results.errors.push(`Crop structure "${structure.field_name}" - ${structure.crop}: ${error.message}`);
          } else {
            results.crop_structure++;
          }
        } catch (err) {
          results.errors.push(`Crop structure "${structure.field_name}" - ${structure.crop}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
