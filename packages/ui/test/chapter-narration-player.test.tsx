// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ChapterNarrationPlayer, splitNarrationText } from "../src/chapter-narration-player.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalSpeechSynthesis = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
const originalUtterance = Object.getOwnPropertyDescriptor(window, "SpeechSynthesisUtterance");

afterEach(() => {
  restoreWindowProperty("speechSynthesis", originalSpeechSynthesis);
  restoreWindowProperty("SpeechSynthesisUtterance", originalUtterance);
  document.body.replaceChildren();
});

describe("ChapterNarrationPlayer", () => {
  test("splits Chinese prose into short sentence chunks", () => {
    const longSentence = "字".repeat(241);

    expect(splitNarrationText(`第一句。第二句！\n${longSentence}`)).toEqual([
      "第一句。",
      "第二句！",
      "字".repeat(240),
      "字"
    ]);
  });

  test("opens without speaking, then plays, pauses, resumes, and closes cleanly", () => {
    const speech = installSpeechSynthesis();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(<ChapterNarrationPlayer body="第一句。第二句。" />);
    });

    const toggle = host.querySelector<HTMLButtonElement>(
      "[aria-controls='chapter-narration-player']"
    );
    act(() => toggle?.click());
    expect(speech.speak).not.toHaveBeenCalled();

    const rate = host.querySelector<HTMLSelectElement>("[aria-label='朗读语速']");
    act(() => {
      if (rate !== null) {
        rate.value = "1.5";
        rate.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    act(() => host.querySelector<HTMLButtonElement>("[aria-label='播放朗读']")?.click());
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.utterances[0]?.text).toBe("第一句。");
    expect(speech.utterances[0]?.rate).toBe(1.5);

    act(() => speech.utterances[0]?.onend?.());
    expect(speech.speak).toHaveBeenCalledTimes(2);
    expect(speech.utterances[1]?.text).toBe("第二句。");
    expect(speech.utterances[1]?.rate).toBe(1.5);

    act(() => host.querySelector<HTMLButtonElement>("[aria-label='暂停朗读']")?.click());
    expect(speech.pause).toHaveBeenCalledOnce();

    act(() => host.querySelector<HTMLButtonElement>("[aria-label='继续朗读']")?.click());
    expect(speech.resume).toHaveBeenCalledOnce();

    act(() => host.querySelector<HTMLButtonElement>("[aria-label='暂停朗读']")?.click());
    act(() => host.querySelector<HTMLButtonElement>("[aria-label='停止朗读']")?.click());
    expect(speech.resume).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("准备朗读");

    act(() => host.querySelector<HTMLButtonElement>("[aria-label='关闭朗读播放器']")?.click());
    expect(speech.cancel).toHaveBeenCalled();
    expect(host.querySelector("#chapter-narration-player")).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  test("cancels when the chapter body changes or the player unmounts", () => {
    const speech = installSpeechSynthesis();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(<ChapterNarrationPlayer body="旧正文。" />);
    });
    act(() =>
      host.querySelector<HTMLButtonElement>("[aria-controls='chapter-narration-player']")?.click()
    );
    act(() => host.querySelector<HTMLButtonElement>("[aria-label='播放朗读']")?.click());
    speech.cancel.mockClear();

    act(() => {
      root.render(<ChapterNarrationPlayer body="新正文。" />);
    });
    expect(speech.cancel).toHaveBeenCalledOnce();

    speech.cancel.mockClear();
    act(() => root.unmount());
    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(speech.addEventListener).toHaveBeenCalledWith("voiceschanged", expect.any(Function));
    expect(speech.removeEventListener).toHaveBeenCalledWith("voiceschanged", expect.any(Function));
    host.remove();
  });
});

function installSpeechSynthesis(): {
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly pause: ReturnType<typeof vi.fn>;
  readonly paused: boolean;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
  readonly resume: ReturnType<typeof vi.fn>;
  readonly speak: ReturnType<typeof vi.fn>;
  readonly utterances: FakeSpeechSynthesisUtterance[];
} {
  const utterances: FakeSpeechSynthesisUtterance[] = [];
  let paused = false;
  const speech = {
    addEventListener: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn(() => []),
    pause: vi.fn(() => {
      paused = true;
    }),
    get paused() {
      return paused;
    },
    removeEventListener: vi.fn(),
    resume: vi.fn(() => {
      paused = false;
    }),
    speak: vi.fn((utterance: FakeSpeechSynthesisUtterance) => utterances.push(utterance))
  };

  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: speech as unknown as SpeechSynthesis
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    value: FakeSpeechSynthesisUtterance as unknown as typeof SpeechSynthesisUtterance
  });

  return { ...speech, utterances };
}

class FakeSpeechSynthesisUtterance {
  lang = "";
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  rate = 1;

  constructor(readonly text: string) {}
}

function restoreWindowProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(window, name);
    return;
  }

  Object.defineProperty(window, name, descriptor);
}
