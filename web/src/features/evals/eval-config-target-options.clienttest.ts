import { EvalTargetObject, type FilterState } from "@langfuse/shared";
import { resolveCheckboxOperator } from "@/src/features/filters/hooks/useSidebarFilterState";
import { evalConfigFilterColumns } from "@/src/server/api/definitions/evalConfigsTable";
import {
  getTraceEvalFilterColumns,
  partitionTraceEvalFilters,
  preserveLegacyTraceEvalFilters,
  sanitizeTraceEvalFilters,
} from "@/src/features/evals/lib/traceEvalFilterColumns";

describe("eval config target filter options", () => {
  it("should exclude all non-trace targets when selecting trace", () => {
    const targetColumn = evalConfigFilterColumns.find(
      (col) => col.id === "target",
    );

    expect(targetColumn?.type).toBe("stringOptions");

    const availableValues =
      targetColumn?.type === "stringOptions"
        ? targetColumn.options.map((option) => option.value)
        : [];

    expect(availableValues).toEqual(
      expect.arrayContaining(Object.values(EvalTargetObject)),
    );

    const result = resolveCheckboxOperator({
      colType: "stringOptions",
      existingFilter: undefined,
      values: [EvalTargetObject.TRACE],
      availableValues,
    });

    expect(result).toEqual({
      finalOperator: "none of",
      finalValues: expect.arrayContaining([
        EvalTargetObject.DATASET,
        EvalTargetObject.EVENT,
        EvalTargetObject.EXPERIMENT,
      ]),
    });
  });

  it("should exclude numeric score filters from trace evaluator filter columns", () => {
    const columns = getTraceEvalFilterColumns();

    expect(columns.find((col) => col.id === "scores_avg")).toBeUndefined();
    expect(columns.find((col) => col.id === "score_categories")).toBeDefined();
    expect(columns.find((col) => col.id === "traceName")).toBeDefined();
  });

  it("should drop stale numeric score filters from saved trace evaluators", () => {
    const legacyFilters: FilterState = [
      {
        column: "scores_avg",
        type: "numberObject",
        operator: ">=",
        key: "accuracy",
        value: 0.8,
      },
      {
        column: "traceName",
        type: "stringOptions",
        operator: "any of",
        value: ["checkout"],
      },
    ];

    expect(sanitizeTraceEvalFilters(legacyFilters)).toEqual([
      {
        column: "traceName",
        type: "stringOptions",
        operator: "any of",
        value: ["checkout"],
      },
    ]);
  });

  it("should keep stale numeric score filters separate from editable filters", () => {
    const legacyFilters: FilterState = [
      {
        column: "scores_avg",
        type: "numberObject",
        operator: ">=",
        key: "accuracy",
        value: 0.8,
      },
      {
        column: "traceName",
        type: "stringOptions",
        operator: "any of",
        value: ["checkout"],
      },
    ];

    expect(partitionTraceEvalFilters(legacyFilters)).toEqual({
      supportedFilters: [
        {
          column: "traceName",
          type: "stringOptions",
          operator: "any of",
          value: ["checkout"],
        },
      ],
      unsupportedFilters: [
        {
          column: "scores_avg",
          type: "numberObject",
          operator: ">=",
          key: "accuracy",
          value: 0.8,
        },
      ],
    });
  });

  it("should preserve legacy numeric score filters when saving trace evaluator edits", () => {
    const existingFilters: FilterState = [
      {
        column: "scores_avg",
        type: "numberObject",
        operator: ">=",
        key: "accuracy",
        value: 0.8,
      },
      {
        column: "traceName",
        type: "stringOptions",
        operator: "any of",
        value: ["checkout"],
      },
    ];

    const submittedFilters: FilterState = [
      {
        column: "traceName",
        type: "stringOptions",
        operator: "any of",
        value: ["search"],
      },
    ];

    expect(
      preserveLegacyTraceEvalFilters({
        existingFilters,
        submittedFilters,
      }),
    ).toEqual([
      {
        column: "scores_avg",
        type: "numberObject",
        operator: ">=",
        key: "accuracy",
        value: 0.8,
      },
      {
        column: "traceName",
        type: "stringOptions",
        operator: "any of",
        value: ["search"],
      },
    ]);
  });
});
