export type SwipeSide = "left" | "right";

export interface SwipeReleaseInput {
  latestX: number;
  velocityX: number;
  leftWidth: number;
  rightWidth: number;
  openSide: SwipeSide | null;
  revealThreshold?: number;
}

const OPEN_DISTANCE_RATIO = 0.46;
const CLOSE_DISTANCE_RATIO = 0.72;
const OPEN_VELOCITY = 720;
const CLOSE_VELOCITY = 320;
const FLING_DISTANCE = 14;

function isActionableSide(value: number, sideWidth: number) {
  return sideWidth > 0 && Math.abs(value) > 0;
}

export function getSwipeReleaseSide({
  latestX,
  leftWidth,
  openSide,
  revealThreshold = 34,
  rightWidth,
  velocityX
}: SwipeReleaseInput): SwipeSide | null {
  const leftOpenThreshold = Math.max(revealThreshold, leftWidth * OPEN_DISTANCE_RATIO);
  const rightOpenThreshold = Math.max(revealThreshold, rightWidth * OPEN_DISTANCE_RATIO);

  if (openSide === "left") {
    return latestX < leftWidth * CLOSE_DISTANCE_RATIO || velocityX < -CLOSE_VELOCITY ? null : "left";
  }

  if (openSide === "right") {
    return Math.abs(latestX) < rightWidth * CLOSE_DISTANCE_RATIO || velocityX > CLOSE_VELOCITY ? null : "right";
  }

  if (
    isActionableSide(latestX, leftWidth) &&
    (latestX > leftOpenThreshold || (velocityX > OPEN_VELOCITY && latestX > FLING_DISTANCE))
  ) {
    return "left";
  }

  if (
    isActionableSide(latestX, rightWidth) &&
    (latestX < -rightOpenThreshold || (velocityX < -OPEN_VELOCITY && latestX < -FLING_DISTANCE))
  ) {
    return "right";
  }

  return null;
}
