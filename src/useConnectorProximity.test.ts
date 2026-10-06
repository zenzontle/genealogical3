import { afterEach, describe, expect, it, vi } from "vitest";
import { trackConnectorProximity } from "./useConnectorProximity";

afterEach(() => vi.unstubAllGlobals());

function canvasFixture(count = 1) {
  class Element extends EventTarget {
    values = new Map<string, string>();
    style = {
      getPropertyValue: (name: string) => this.values.get(name) || "",
      setProperty: (name: string, value: string) =>
        this.values.set(name, value),
    };
    rect = { left: 0, right: 220, top: 0, bottom: 140 };
    getBoundingClientRect = vi.fn(() => this.rect);
    constructor(public className = "person-card") {
      super();
    }
    matches(selector: string) {
      return selector.split(", ").includes(`.${this.className}`);
    }
  }
  const cards = Array.from({ length: count }, (_, index) => {
    const card = new Element();
    card.rect.left = index * 300;
    card.rect.right = card.rect.left + 220;
    return card;
  });
  const canvas = Object.assign(new Element("canvas"), {
    querySelectorAll: vi.fn(() => cards),
  });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let mutation: MutationCallback;
  let resize: ResizeObserverCallback;
  const disconnectResize = vi.fn(),
    disconnectMutation = vi.fn();
  const unobserve = vi.fn();
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) =>
    frames.delete(frame),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn();
      unobserve = unobserve;
      disconnect = disconnectResize;
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: MutationCallback) {
        mutation = callback;
      }
      observe = vi.fn();
      disconnect = disconnectMutation;
    },
  );
  const stop = trackConnectorProximity(canvas as unknown as HTMLElement);
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };
  const move = (x: number, y = 50) => {
    canvas.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: x, clientY: y }),
    );
    flush();
  };
  const mutate = (
    type: string,
    target = new Element("react-flow__node"),
    attributeName = "style",
  ) => {
    mutation!(
      [{ type, target, attributeName } as unknown as MutationRecord],
      {} as MutationObserver,
    );
    flush();
  };
  const opacity = (card = cards[0]) => card.values.get("--connector-opacity");
  return {
    canvas,
    cards,
    Element,
    move,
    mutate,
    opacity,
    flush,
    stop,
    unobserve,
    resized: () => {
      resize!([], {} as ResizeObserver);
      flush();
    },
    disconnectResize,
    disconnectMutation,
  };
}

describe("cached connector proximity", () => {
  it("performs no further layout reads during pointer movement across 2,000 cards", () => {
    const f = canvasFixture(2000);
    f.move(-40);
    expect(f.opacity()).toBe("0.50");
    for (let frame = 0; frame < 60; frame++) f.move(-frame);
    // Opacity writes are observed too; they must not invalidate geometry.
    f.mutate("attributes", f.cards[0], "style");
    f.move(50);
    expect(f.opacity()).toBe("1.00");
    expect(f.canvas.querySelectorAll).toHaveBeenCalledOnce();
    expect(
      f.cards.every(
        (card) => card.getBoundingClientRect.mock.calls.length === 1,
      ),
    ).toBe(true);
    f.stop();
  });

  it("refreshes after drag, pan/zoom, resize, and card changes and cleans up", () => {
    const f = canvasFixture();
    f.move(40);
    expect(f.opacity()).toBe("1.00");
    f.cards[0].rect = { left: 500, right: 720, top: 0, bottom: 140 };
    f.mutate("attributes");
    expect(f.opacity()).toBe("0.00");
    f.cards[0].rect = { left: 80, right: 300, top: 0, bottom: 140 };
    f.mutate("attributes", new f.Element("react-flow__viewport"));
    expect(f.opacity()).toBe("0.50");
    f.cards[0].rect.left = 40;
    f.resized();
    expect(f.opacity()).toBe("1.00");
    const added = new f.Element();
    f.cards.push(added);
    f.mutate("childList");
    expect(f.opacity(added)).toBe("1.00");
    f.cards.pop();
    f.mutate("childList");
    expect(f.unobserve).toHaveBeenCalledWith(added);
    const reads = f.canvas.querySelectorAll.mock.calls.length;
    f.canvas.dispatchEvent(new Event("pointerleave"));
    f.flush();
    expect(f.opacity()).toBe("0.00");
    expect(f.canvas.querySelectorAll.mock.calls.length).toBe(reads);
    f.stop();
    f.move(40);
    expect(f.canvas.querySelectorAll.mock.calls.length).toBe(reads);
    expect(f.disconnectResize).toHaveBeenCalledOnce();
    expect(f.disconnectMutation).toHaveBeenCalledOnce();
  });
});
