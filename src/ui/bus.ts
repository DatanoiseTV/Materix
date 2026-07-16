// Tiny app-level command bus so deep components (timeline, member list) can
// trigger app-shell actions (open a room, show a verification flow) without
// prop drilling.

import type { SasFlow } from "../core/types";
import type { Selection } from "./RoomList";

type Handlers = {
  openRoom: (sel: Selection) => void;
  showFlow: (flow: SasFlow) => void;
};

const handlers: Partial<Handlers> = {};

export const uiBus = {
  register<K extends keyof Handlers>(key: K, fn: Handlers[K]): () => void {
    handlers[key] = fn;
    return () => {
      if (handlers[key] === fn) delete handlers[key];
    };
  },
  openRoom(sel: Selection): void {
    handlers.openRoom?.(sel);
  },
  showFlow(flow: SasFlow): void {
    handlers.showFlow?.(flow);
  },
};
