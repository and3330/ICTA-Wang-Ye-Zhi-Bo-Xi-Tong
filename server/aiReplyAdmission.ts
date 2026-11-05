const RATE_WINDOW_MS = 60_000;
const DUPLICATE_WINDOW_MS = 15_000;
const STATE_TTL_MS = 10 * 60_000;
const MAX_VIEWER_STATES = 10_000;
const SESSION_RATE_LIMIT = 6;
const WEBINAR_IN_FLIGHT_LIMIT = 8;
const OWNER_IN_FLIGHT_LIMIT = 16;
// When the room is busy a question waits its turn instead of being refused.
export const AI_REPLY_QUEUE_WAIT_MS = 45_000;
const QUEUE_POLL_MS = 250;
const MAX_QUEUED_PER_WEBINAR = 40;
export const VIEWER_CHAT_MAX_CHARS = 2_000;

export type AiReplyAdmissionInput = {
  ownerId: string;
  webinarId: string;
  viewerId: string;
  question: string;
  now?: number;
};

export type AiReplyAdmissionDenialReason =
  | "duplicate"
  | "viewer_busy"
  | "session_rate"
  | "webinar_busy"
  | "owner_busy";

export type AiReplyAdmissionDenied = {
  accepted: false;
  reason: AiReplyAdmissionDenialReason;
  message: string;
};

export type AiReplyAdmissionLease = {
  accepted: true;
  release: () => void;
};

export function validateViewerChatContent(value: unknown):
  | { ok: true; value: string }
  | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: "聊天內容格式不正確" };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: "聊天內容不可為空白" };
  if (trimmed.length > VIEWER_CHAT_MAX_CHARS) {
    return { ok: false, message: `聊天內容不可超過 ${VIEWER_CHAT_MAX_CHARS} 字` };
  }
  return { ok: true, value: trimmed };
}

type ViewerState = {
  inFlight: boolean;
  attempts: number[];
  questions: Map<string, number>;
  touchedAt: number;
};
type CounterState = { inFlight: number; touchedAt: number };

const DENIAL_MESSAGES: Record<AiReplyAdmissionDenialReason, string> = {
  duplicate: "相同問題正在處理或剛完成，請稍候再試。",
  viewer_busy: "AI 助教正在處理你上一個問題，請稍候。",
  session_rate: "提問速度過快，請稍候一分鐘再試。",
  webinar_busy: "AI 助教目前忙碌中，請稍候再試。",
  owner_busy: "AI 助教目前忙碌中，請稍候再試。",
};

function normalizedQuestion(question: string) {
  return question.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export class AiReplyAdmissionController {
  private viewers = new Map<string, ViewerState>();
  private webinars = new Map<string, CounterState>();
  private owners = new Map<string, CounterState>();
  /** Viewers with a question waiting in the queue, and how many wait per webinar. */
  private queuedViewers = new Set<string>();
  private queuedPerWebinar = new Map<string, number>();
  private webinarLimit: number;
  private ownerLimit: number;

  constructor(limits: { webinar?: number; owner?: number } = {}) {
    this.webinarLimit = limits.webinar ?? WEBINAR_IN_FLIGHT_LIMIT;
    this.ownerLimit = limits.owner ?? OWNER_IN_FLIGHT_LIMIT;
  }

  static viewerKey(input: AiReplyAdmissionInput) {
    return `${input.ownerId}\0${input.webinarId}\0${input.viewerId}`;
  }

  /** Holds a queue place; false when this viewer already waits or the queue is full. */
  enqueue(input: AiReplyAdmissionInput): boolean {
    const key = AiReplyAdmissionController.viewerKey(input);
    const waiting = this.queuedPerWebinar.get(input.webinarId) ?? 0;
    if (this.queuedViewers.has(key) || waiting >= MAX_QUEUED_PER_WEBINAR) return false;
    this.queuedViewers.add(key);
    this.queuedPerWebinar.set(input.webinarId, waiting + 1);
    return true;
  }

  dequeue(input: AiReplyAdmissionInput) {
    const key = AiReplyAdmissionController.viewerKey(input);
    if (!this.queuedViewers.delete(key)) return;
    const waiting = (this.queuedPerWebinar.get(input.webinarId) ?? 1) - 1;
    if (waiting > 0) this.queuedPerWebinar.set(input.webinarId, waiting);
    else this.queuedPerWebinar.delete(input.webinarId);
  }

  acquire(input: AiReplyAdmissionInput, fromQueue = false): AiReplyAdmissionLease | AiReplyAdmissionDenied {
    const now = input.now ?? Date.now();
    this.cleanup(now);
    const viewerKey = AiReplyAdmissionController.viewerKey(input);
    // A viewer whose question is waiting asks again: same as "still working on it".
    if (!fromQueue && this.queuedViewers.has(viewerKey)) return this.denied("viewer_busy");
    const question = normalizedQuestion(input.question);
    let viewer = this.viewers.get(viewerKey);
    if (!viewer) {
      viewer = { inFlight: false, attempts: [], questions: new Map(), touchedAt: now };
      this.viewers.set(viewerKey, viewer);
    }
    viewer.touchedAt = now;
    viewer.attempts = viewer.attempts.filter(at => now - at < RATE_WINDOW_MS);
    for (const [value, at] of Array.from(viewer.questions.entries())) {
      if (now - at >= DUPLICATE_WINDOW_MS) viewer.questions.delete(value);
    }

    if (viewer.questions.has(question)) return this.denied("duplicate");
    if (viewer.inFlight) return this.denied("viewer_busy");
    if (viewer.attempts.length >= SESSION_RATE_LIMIT) return this.denied("session_rate");

    const webinar = this.webinars.get(input.webinarId) || { inFlight: 0, touchedAt: now };
    const owner = this.owners.get(input.ownerId) || { inFlight: 0, touchedAt: now };
    if (webinar.inFlight >= this.webinarLimit) return this.denied("webinar_busy");
    if (owner.inFlight >= this.ownerLimit) return this.denied("owner_busy");

    viewer.inFlight = true;
    viewer.attempts.push(now);
    viewer.questions.set(question, now);
    webinar.inFlight += 1;
    webinar.touchedAt = now;
    owner.inFlight += 1;
    owner.touchedAt = now;
    this.webinars.set(input.webinarId, webinar);
    this.owners.set(input.ownerId, owner);

    let released = false;
    return {
      accepted: true,
      release: () => {
        if (released) return;
        released = true;
        viewer!.inFlight = false;
        viewer!.touchedAt = Date.now();
        const currentWebinar = this.webinars.get(input.webinarId);
        if (currentWebinar) {
          currentWebinar.inFlight = Math.max(0, currentWebinar.inFlight - 1);
          currentWebinar.touchedAt = Date.now();
        }
        const currentOwner = this.owners.get(input.ownerId);
        if (currentOwner) {
          currentOwner.inFlight = Math.max(0, currentOwner.inFlight - 1);
          currentOwner.touchedAt = Date.now();
        }
      },
    };
  }

  private denied(reason: AiReplyAdmissionDenialReason): AiReplyAdmissionDenied {
    return { accepted: false, reason, message: DENIAL_MESSAGES[reason] };
  }

  private cleanup(now: number) {
    for (const [key, state] of Array.from(this.viewers.entries())) {
      if (!state.inFlight && now - state.touchedAt >= STATE_TTL_MS) this.viewers.delete(key);
    }
    for (const [key, state] of Array.from(this.webinars.entries())) {
      if (state.inFlight === 0 && now - state.touchedAt >= STATE_TTL_MS) this.webinars.delete(key);
    }
    for (const [key, state] of Array.from(this.owners.entries())) {
      if (state.inFlight === 0 && now - state.touchedAt >= STATE_TTL_MS) this.owners.delete(key);
    }
    if (this.viewers.size > MAX_VIEWER_STATES) {
      const removable = Array.from(this.viewers.entries())
        .filter(([, state]) => !state.inFlight)
        .sort((a, b) => a[1].touchedAt - b[1].touchedAt);
      for (const [key] of removable.slice(0, this.viewers.size - MAX_VIEWER_STATES)) {
        this.viewers.delete(key);
      }
    }
  }
}

export async function executeAdmittedAiReply<T>(
  controller: AiReplyAdmissionController,
  input: AiReplyAdmissionInput,
  work: () => Promise<T>,
  options: { queueMs?: number; onQueued?: () => void } = {},
): Promise<{ accepted: true; value: T } | AiReplyAdmissionDenied> {
  let admission = controller.acquire(input);
  const roomBusy = (result: typeof admission) =>
    !result.accepted && (result.reason === "webinar_busy" || result.reason === "owner_busy");
  // Only a full room waits; a viewer's own limits (duplicate, too fast) never queue.
  if (roomBusy(admission) && (options.queueMs ?? 0) > 0 && controller.enqueue(input)) {
    options.onQueued?.();
    const deadline = Date.now() + options.queueMs!;
    try {
      while (roomBusy(admission) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, QUEUE_POLL_MS));
        admission = controller.acquire({ ...input, now: undefined }, true);
      }
    } finally {
      controller.dequeue(input);
    }
  }
  if (!admission.accepted) return admission;
  try {
    return { accepted: true, value: await work() };
  } finally {
    admission.release();
  }
}

export const aiReplyAdmission = new AiReplyAdmissionController();