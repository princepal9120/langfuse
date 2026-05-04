import { Button } from "@/src/components/ui/button";
import { useCopyToClipboard } from "@/src/hooks/useCopyToClipboard";
import { Check, Copy, ExternalLinkIcon } from "lucide-react";
import { Fragment } from "react";

const LANGFUSE_METADATA_GROUP_ID = "langfuse";
const OTHER_METADATA_GROUP_ID = "other";
const OTHER_METADATA_GROUP_LABEL = "Other";

type MetadataGroup = {
  id: string;
  label: string;
  entries: Array<{ originalKey: string; displayKey: string; value: unknown }>;
};

const isSafeHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const formatExperimentMetadataValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const groupMetadata = (
  metadata: Record<string, unknown> | undefined,
): MetadataGroup[] => {
  const groups = new Map<string, MetadataGroup>();

  Object.entries(metadata ?? {}).forEach(([key, value]) => {
    const separatorIndex = key.indexOf(".");
    const hasNamespace = separatorIndex > 0;

    // Dotted metadata keys keep action-owned metadata scannable without hiding
    // arbitrary user metadata. Example: "langfuse.job_url" is shown as group
    // "langfuse" with display key "job_url"; keys without a namespace are
    // collected in the fallback "Other" group.
    const groupId = hasNamespace
      ? key.slice(0, separatorIndex)
      : OTHER_METADATA_GROUP_ID;
    const displayKey = hasNamespace ? key.slice(separatorIndex + 1) : key;
    const label = hasNamespace ? groupId : OTHER_METADATA_GROUP_LABEL;

    const group = groups.get(groupId) ?? { id: groupId, label, entries: [] };
    group.entries.push({ originalKey: key, displayKey, value });
    groups.set(groupId, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      entries: group.entries.sort((a, b) =>
        a.displayKey.localeCompare(b.displayKey),
      ),
    }))
    .sort((a, b) => {
      // Langfuse-owned metadata is most relevant for experiment-action runs;
      // un-namespaced metadata is least structured, so keep it last.
      if (a.id === LANGFUSE_METADATA_GROUP_ID) return -1;
      if (b.id === LANGFUSE_METADATA_GROUP_ID) return 1;
      if (a.id === OTHER_METADATA_GROUP_ID) return 1;
      if (b.id === OTHER_METADATA_GROUP_ID) return -1;
      return a.label.localeCompare(b.label);
    });
};

const MetadataValue = ({ value }: { value: unknown }) => {
  const { copy, isCopied } = useCopyToClipboard({ successDuration: 1_500 });
  const displayValue = formatExperimentMetadataValue(value);

  if (typeof value === "string" && isSafeHttpUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary inline-flex max-w-full min-w-0 items-center hover:underline"
      >
        <span className="truncate">{displayValue}</span>
        <ExternalLinkIcon className="ml-1 h-3 w-3 shrink-0" />
      </a>
    );
  }

  return (
    <span className="group/value inline-flex max-w-full min-w-0 items-center gap-1">
      <span className="truncate">{displayValue}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="h-4 w-4 shrink-0 opacity-0 group-hover/value:opacity-100"
        onClick={() => void copy(displayValue)}
        title="Copy value"
        aria-label="Copy metadata value"
      >
        {isCopied ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </span>
  );
};

export const ExperimentMetadataSection = ({
  metadata,
}: {
  metadata: Record<string, unknown> | undefined;
}) => {
  if (Object.keys(metadata ?? {}).length === 0) return null;

  const groups = groupMetadata(metadata);

  return (
    <div className="border-t pt-4">
      <h4 className="mb-2 text-sm font-medium">Metadata</h4>
      <table className="w-full table-auto border-separate border-spacing-0 text-xs">
        <tbody>
          {groups.map((group, index) => (
            <Fragment key={group.id}>
              <tr>
                <th
                  colSpan={2}
                  className={`text-muted-foreground pb-1 text-left font-medium uppercase ${index === 0 ? "pt-0" : "pt-2"}`}
                >
                  {group.label}
                </th>
              </tr>
              {group.entries.map((entry) => (
                <tr key={entry.originalKey} title={entry.originalKey}>
                  <td className="w-1 pr-8 align-top font-mono whitespace-nowrap">
                    <span className="block max-w-[24ch] truncate">
                      {entry.displayKey}
                    </span>
                  </td>
                  <td className="max-w-0 align-top">
                    <MetadataValue value={entry.value} />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};
