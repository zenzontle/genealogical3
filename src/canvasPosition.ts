import { personCardHeight, type Tree } from "./model";

export function personPositionAtViewCenter(
  viewport: Tree["viewport"],
  size: { width: number; height: number },
  hasHome: boolean,
) {
  return {
    x: (size.width / 2 - viewport.x) / viewport.zoom - 110,
    y:
      (size.height / 2 - viewport.y) / viewport.zoom -
      personCardHeight(hasHome) / 2,
  };
}
