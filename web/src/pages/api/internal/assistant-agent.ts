import { randomUUID } from "crypto";
import { EventType, RunAgentInputSchema, type Message } from "@ag-ui/core";
import {
  query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/src/env.mjs";

export const config = {
  api: {
    bodyParser: true,
  },
};

const LLMS_TXT_URL = "https://langfuse.com/llms.txt";
const ASSISTANT_TITLE = "Langfuse Workspace Assistant";
const ASSISTANT_SYSTEM_PROMPT = [
  "You are the persistent in-app assistant for Langfuse.",
  "Be concise, factual, and useful.",
  "Answer questions using the Langfuse documentation context provided to you.",
  "If the documentation context does not answer the question, say that directly instead of guessing.",
  "Use markdown when it improves clarity.",
].join(" ");
const LLMS_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedLlmsContext:
  | {
      expiresAt: number;
      value: string;
    }
  | undefined;
let llmsContextPromise: Promise<string> | undefined;

function getClaudeSdkEnv() {
  return {
    ...(env.ANTHROPIC_API_KEY
      ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }
      : {}),
    CLAUDE_AGENT_SDK_CLIENT_APP: "langfuse-web-assistant",
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "Assistant is not configured" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const parsedInput = RunAgentInputSchema.safeParse(req.body);

  if (!parsedInput.success) {
    res.status(400).json({ error: "Invalid AG-UI payload" });
    return;
  }

  const input = parsedInput.data;
  const prompt = getLatestUserMessageContent(input.messages);

  if (!prompt) {
    res.status(400).json({ error: "Missing user message" });
    return;
  }

  const assistantMessageId = randomUUID();
  const reasoningMessageId = randomUUID();
  const streamState = createStreamState();

  setupSseResponse(res);
  sendSse(res, {
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
    parentRunId: input.parentRunId,
    input,
  });

  try {
    const llmsContext = await getLlmsContext();
    const sdkQuery = query({
      prompt,
      options: {
        permissionMode: "dontAsk",
        resume: getClaudeSessionId(input.state),
        title: ASSISTANT_TITLE,
        systemPrompt: [ASSISTANT_SYSTEM_PROMPT, llmsContext],
        env: getClaudeSdkEnv(),
      },
    });

    for await (const sdkMessage of sdkQuery) {
      handleSdkMessage(
        sdkMessage,
        res,
        assistantMessageId,
        reasoningMessageId,
        streamState,
      );
    }

    closeOpenMessages(res, assistantMessageId, reasoningMessageId, streamState);
    sendFinished(res, input.threadId, input.runId);
  } catch (error) {
    closeOpenMessages(res, assistantMessageId, reasoningMessageId, streamState);

    if (!streamState.runErrored) {
      sendRunError(
        res,
        error instanceof Error ? error.message : "Unknown assistant error",
      );
    }

    sendFinished(res, input.threadId, input.runId);
  } finally {
    res.end();
  }
}

function handleSdkMessage(
  sdkMessage: SDKMessage,
  res: NextApiResponse,
  assistantMessageId: string,
  reasoningMessageId: string,
  streamState: ReturnType<typeof createStreamState>,
) {
  switch (sdkMessage.type) {
    case "system": {
      if (sdkMessage.subtype === "init") {
        sendSse(res, {
          type: EventType.STATE_DELTA,
          delta: [
            {
              op: "add",
              path: "/claudeSessionId",
              value: sdkMessage.session_id,
            },
          ],
        });
      }
      return;
    }
    case "stream_event": {
      handlePartialAssistantMessage(
        sdkMessage,
        res,
        assistantMessageId,
        reasoningMessageId,
        streamState,
      );
      return;
    }
    case "assistant": {
      handleFinalAssistantMessage(
        sdkMessage,
        res,
        assistantMessageId,
        streamState,
      );
      return;
    }
    case "result": {
      if (sdkMessage.is_error) {
        streamState.runErrored = true;
        sendRunError(res, sdkMessage.result);
      } else {
        sendSse(res, {
          type: EventType.STEP_FINISHED,
          stepName: "claude-agent-sdk",
        });
      }
      return;
    }
    default: {
      sendSse(res, {
        type: EventType.RAW,
        event: sdkMessage,
        source: "claude-agent-sdk",
      });
    }
  }
}

function handlePartialAssistantMessage(
  sdkMessage: SDKPartialAssistantMessage,
  res: NextApiResponse,
  assistantMessageId: string,
  reasoningMessageId: string,
  streamState: ReturnType<typeof createStreamState>,
) {
  const event = readPartialAssistantEvent(sdkMessage);

  if (!event) {
    return;
  }

  if (event.type === "content_block_start") {
    if (event.contentType === "text" && !streamState.assistantStarted) {
      streamState.assistantStarted = true;
      sendSse(res, {
        type: EventType.TEXT_MESSAGE_START,
        messageId: assistantMessageId,
        role: "assistant",
      });
    }

    if (event.contentType === "thinking" && !streamState.reasoningStarted) {
      streamState.reasoningStarted = true;
      sendSse(res, {
        type: EventType.REASONING_START,
        messageId: reasoningMessageId,
      });
      sendSse(res, {
        type: EventType.REASONING_MESSAGE_START,
        messageId: reasoningMessageId,
      });
    }

    if (event.contentType === "tool_use" && event.toolCallId) {
      sendSse(res, {
        type: EventType.TOOL_CALL_START,
        toolCallId: event.toolCallId,
        toolCallName: event.toolCallName,
        parentMessageId: assistantMessageId,
      });
    }

    return;
  }

  if (event.type === "content_block_delta") {
    if (event.deltaType === "text_delta" && event.text) {
      if (!streamState.assistantStarted) {
        streamState.assistantStarted = true;
        sendSse(res, {
          type: EventType.TEXT_MESSAGE_START,
          messageId: assistantMessageId,
          role: "assistant",
        });
      }

      sendSse(res, {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: assistantMessageId,
        delta: event.text,
      });
    }

    if (event.deltaType === "thinking_delta" && event.text) {
      if (!streamState.reasoningStarted) {
        streamState.reasoningStarted = true;
        sendSse(res, {
          type: EventType.REASONING_START,
          messageId: reasoningMessageId,
        });
        sendSse(res, {
          type: EventType.REASONING_MESSAGE_START,
          messageId: reasoningMessageId,
        });
      }

      sendSse(res, {
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: reasoningMessageId,
        delta: event.text,
      });
    }

    if (event.deltaType === "input_json_delta" && event.partialJson) {
      sendSse(res, {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: event.toolCallId,
        delta: event.partialJson,
      });
    }

    return;
  }

  if (event.contentType === "text" && streamState.assistantStarted) {
    streamState.assistantClosed = true;
    sendSse(res, {
      type: EventType.TEXT_MESSAGE_END,
      messageId: assistantMessageId,
    });
  }

  if (event.contentType === "thinking" && streamState.reasoningStarted) {
    streamState.reasoningClosed = true;
    sendSse(res, {
      type: EventType.REASONING_MESSAGE_END,
      messageId: reasoningMessageId,
    });
    sendSse(res, {
      type: EventType.REASONING_END,
      messageId: reasoningMessageId,
    });
  }

  if (event.contentType === "tool_use" && event.toolCallId) {
    sendSse(res, {
      type: EventType.TOOL_CALL_END,
      toolCallId: event.toolCallId,
    });
  }
}

function handleFinalAssistantMessage(
  sdkMessage: SDKAssistantMessage,
  res: NextApiResponse,
  assistantMessageId: string,
  streamState: Pick<
    ReturnType<typeof createStreamState>,
    "assistantStarted" | "assistantClosed"
  >,
) {
  if (streamState.assistantStarted) {
    return;
  }

  const text = sdkMessage.message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n");

  if (!text) {
    return;
  }

  sendSse(res, {
    type: EventType.TEXT_MESSAGE_START,
    messageId: assistantMessageId,
    role: "assistant",
  });
  sendSse(res, {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: assistantMessageId,
    delta: text,
  });
  sendSse(res, {
    type: EventType.TEXT_MESSAGE_END,
    messageId: assistantMessageId,
  });

  streamState.assistantStarted = true;
  streamState.assistantClosed = true;
}

function createStreamState() {
  return {
    assistantStarted: false,
    assistantClosed: false,
    reasoningStarted: false,
    reasoningClosed: false,
    runErrored: false,
  };
}

function closeOpenMessages(
  res: NextApiResponse,
  assistantMessageId: string,
  reasoningMessageId: string,
  streamState: ReturnType<typeof createStreamState>,
) {
  if (streamState.reasoningStarted && !streamState.reasoningClosed) {
    sendSse(res, {
      type: EventType.REASONING_MESSAGE_END,
      messageId: reasoningMessageId,
    });
    sendSse(res, {
      type: EventType.REASONING_END,
      messageId: reasoningMessageId,
    });
    streamState.reasoningClosed = true;
  }

  if (streamState.assistantStarted && !streamState.assistantClosed) {
    sendSse(res, {
      type: EventType.TEXT_MESSAGE_END,
      messageId: assistantMessageId,
    });
    streamState.assistantClosed = true;
  }
}

function getLatestUserMessageContent(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      return message.content.trim();
    }

    const text = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function getClaudeSessionId(state: unknown) {
  if (!isRecord(state)) {
    return undefined;
  }

  const claudeSessionId = state.claudeSessionId;
  return typeof claudeSessionId === "string" ? claudeSessionId : undefined;
}

function readPartialAssistantEvent(sdkMessage: SDKPartialAssistantMessage) {
  const event = sdkMessage.event;

  if (!isRecord(event) || typeof event.type !== "string") {
    return null;
  }

  if (event.type === "content_block_start") {
    const contentBlock = readContentBlock(event.content_block);

    if (!contentBlock) {
      return null;
    }

    return {
      type: event.type,
      ...contentBlock,
    };
  }

  if (event.type === "content_block_delta") {
    const delta = readDelta(event.delta);

    if (!delta) {
      return null;
    }

    const contentBlock = readContentBlock(event.content_block);

    return {
      type: event.type,
      ...delta,
      toolCallId: contentBlock?.toolCallId,
    };
  }

  if (event.type === "content_block_stop") {
    const contentBlock = readContentBlock(event.content_block);

    if (!contentBlock) {
      return null;
    }

    return {
      type: event.type,
      ...contentBlock,
    };
  }

  return null;
}

function readContentBlock(value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  return {
    contentType: value.type,
    toolCallId: typeof value.id === "string" ? value.id : undefined,
    toolCallName: typeof value.name === "string" ? value.name : undefined,
  };
}

function readDelta(value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  return {
    deltaType: value.type,
    text: typeof value.text === "string" ? value.text : undefined,
    partialJson:
      typeof value.partial_json === "string" ? value.partial_json : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function setupSseResponse(res: NextApiResponse) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function sendFinished(res: NextApiResponse, threadId: string, runId: string) {
  sendSse(res, {
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
  });
}

function sendRunError(res: NextApiResponse, message: string) {
  sendSse(res, {
    type: EventType.RUN_ERROR,
    message,
  });
}

function sendSse(res: NextApiResponse, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function getLlmsContext() {
  const now = Date.now();

  if (cachedLlmsContext && cachedLlmsContext.expiresAt > now) {
    return cachedLlmsContext.value;
  }

  if (!llmsContextPromise) {
    llmsContextPromise = fetchLlmsContext();
  }

  try {
    const value = await llmsContextPromise;
    cachedLlmsContext = {
      value,
      expiresAt: now + LLMS_CONTEXT_CACHE_TTL_MS,
    };
    return value;
  } finally {
    llmsContextPromise = undefined;
  }
}

async function fetchLlmsContext() {
  const response = await fetch(LLMS_TXT_URL, {
    headers: {
      Accept: "text/plain",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to load Langfuse docs context from ${LLMS_TXT_URL} (${response.status})`,
    );
  }

  const text = (await response.text()).trim();

  if (!text) {
    throw new Error(`Langfuse docs context at ${LLMS_TXT_URL} was empty`);
  }

  return [`Langfuse documentation context from ${LLMS_TXT_URL}:`, text].join(
    "\n\n",
  );
}
