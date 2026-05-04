"use client";

import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useMessagePartText,
} from "@assistant-ui/react";
import { Bot, PanelRightClose, SendHorizontal } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@/src/components/ui/button";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { cn } from "@/src/utils/tailwind";
import { useAssistantSidebar } from "./AssistantSidebarProvider";

export function AssistantSidebarPanel() {
  const { setOpen } = useAssistantSidebar();

  return (
    <section className="bg-background flex h-full min-w-0 flex-col border-l">
      <header className="bg-muted/40 flex items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-primary/10 text-primary flex h-9 w-9 items-center justify-center rounded-xl">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Assistant</p>
            <p className="text-muted-foreground truncate text-xs">
              Read-only help over this workspace
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(false)}
          aria-label="Close assistant sidebar"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </header>

      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
            <AuiIf condition={(state) => state.thread.isEmpty}>
              <div className="border-border/70 bg-muted/30 rounded-2xl border border-dashed px-4 py-5">
                <p className="text-sm font-medium">Ask about Langfuse</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  This first pass answers from Langfuse documentation context.
                  It does not inspect the codebase or call tools.
                </p>
              </div>
            </AuiIf>

            <ThreadPrimitive.Messages>
              {() => <AssistantSidebarMessage />}
            </ThreadPrimitive.Messages>
          </div>
        </ScrollArea>

        <div className="bg-background/95 border-t p-3 backdrop-blur-sm">
          <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end gap-2">
            <ComposerPrimitive.Input
              placeholder="Ask about Langfuse docs..."
              submitMode="enter"
              rows={1}
              className="border-input bg-background focus-visible:ring-ring min-h-11 flex-1 resize-none rounded-xl border px-3 py-2 text-sm shadow-xs ring-2 focus-visible:outline-hidden"
            />
            <ComposerPrimitive.Send asChild>
              <Button
                size="icon"
                className="h-11 w-11 rounded-xl"
                aria-label="Send message"
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
    </section>
  );
}

function AssistantSidebarMessage() {
  const role = useAuiState((state) => state.message.role);

  if (role === "system") {
    return null;
  }

  const isUser = role === "user";
  const isReasoning = role === "reasoning";

  return (
    <MessagePrimitive.Root
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-4 py-3 text-sm shadow-xs",
          isUser
            ? "bg-primary text-primary-foreground"
            : isReasoning
              ? "bg-muted text-muted-foreground border-border/70 border"
              : "bg-card text-card-foreground border-border/70 border",
        )}
      >
        {!isUser && (
          <div className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
            {isReasoning ? "Thinking" : "Assistant"}
          </div>
        )}
        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type !== "text") {
              return null;
            }

            return isUser ? <UserTextPart /> : <AssistantTextPart />;
          }}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantTextPart() {
  const { text } = useMessagePartText();

  return (
    <div className="assistant-streamdown text-sm leading-6">
      <Streamdown>{text}</Streamdown>
    </div>
  );
}

function UserTextPart() {
  const { text } = useMessagePartText();

  return <p className="leading-6 whitespace-pre-wrap">{text}</p>;
}
