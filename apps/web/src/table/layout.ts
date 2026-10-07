// The table is drawn on a fixed 1280x800 canvas that scales to the window, like a poker client.
export const W = 1280;
export const H = 800;

/** Seat centers for opponents, going left around the table from you (you sit bottom center). */
const OPP: Record<number, [number, number][]> = {
  2: [[245, 200], [1035, 200]],
  3: [[185, 330], [640, 112], [1095, 330]],
  4: [[180, 395], [385, 125], [895, 125], [1100, 395]],
  5: [[165, 410], [235, 175], [640, 100], [1045, 175], [1115, 410]],
};

export const HUMAN_SEAT: [number, number] = [640, 548];

export function seatPos(seat: number, n: number, human: number): [number, number] {
  if (seat === human) return HUMAN_SEAT;
  const i = (seat - human + n) % n; // 1..n-1
  return OPP[n - 1][i - 1];
}
