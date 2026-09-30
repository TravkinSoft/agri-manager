export function summarizeLandUseAreas(
  rows: Array<{ land_use_type?: string | null; area?: number | string | null }>
): { cropArea: number; fallowArea: number } {
  return rows.reduce(
    (summary, row) => {
      const area = Number(row.area || 0);
      if (row.land_use_type === "fallow") summary.fallowArea += area;
      else summary.cropArea += area;
      return summary;
    },
    { cropArea: 0, fallowArea: 0 }
  );
}
