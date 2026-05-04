import {
  type FilterState,
  type TraceOptions,
  tracesTableColsWithOptions,
} from "@langfuse/shared";
import { validateFilters } from "@/src/components/table/table-view-presets/validation";

export const getTraceEvalFilterColumns = (options?: TraceOptions) =>
  tracesTableColsWithOptions(options).filter(
    (column) => column.id !== "scores_avg",
  );

export const partitionTraceEvalFilters = (
  filters: FilterState | null | undefined,
  options?: TraceOptions,
) => {
  const supportedFilters = validateFilters(
    filters ?? [],
    getTraceEvalFilterColumns(options),
  );
  const supportedFilterJson = new Set(
    supportedFilters.map((filter) => JSON.stringify(filter)),
  );

  return {
    supportedFilters,
    unsupportedFilters: (filters ?? []).filter(
      (filter) => !supportedFilterJson.has(JSON.stringify(filter)),
    ),
  };
};

export const sanitizeTraceEvalFilters = (
  filters: FilterState | null | undefined,
  options?: TraceOptions,
): FilterState => partitionTraceEvalFilters(filters, options).supportedFilters;

export const preserveLegacyTraceEvalFilters = ({
  existingFilters,
  submittedFilters,
  options,
}: {
  existingFilters: FilterState | null | undefined;
  submittedFilters: FilterState | null | undefined;
  options?: TraceOptions;
}): FilterState => [
  ...partitionTraceEvalFilters(existingFilters, options).unsupportedFilters,
  ...sanitizeTraceEvalFilters(submittedFilters, options),
];
