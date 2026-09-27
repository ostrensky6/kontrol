const VERSION = 3;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 55;
const ECC_CODEWORDS = 15;

type Cell = boolean | null;

type QrCodeProps = {
  value: string;
  label?: string;
  size?: number;
  className?: string;
};

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;

  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }

  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = Array<number>(divisor.length).fill(0);

  for (const value of data) {
    const factor = value ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }

  return result;
}

function appendBits(bits: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
}

function encodeData(value: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > 53) {
    throw new Error("O QR interno suporta até 53 bytes nesta etiqueta mínima.");
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);

  const capacityBits = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(Number.parseInt(bits.slice(i, i + 8).join(""), 2));
  }
  for (let pad = 0xec; data.length < DATA_CODEWORDS; pad ^= 0xec ^ 0x11) {
    data.push(pad);
  }

  return data;
}

function drawFinder(modules: Cell[][], reserved: boolean[][], x: number, y: number) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= SIZE || yy < 0 || yy >= SIZE) continue;

      const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const black =
        inFinder &&
        (dx === 0 ||
          dx === 6 ||
          dy === 0 ||
          dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      modules[yy][xx] = black;
      reserved[yy][xx] = true;
    }
  }
}

function drawAlignment(modules: Cell[][], reserved: boolean[][], cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const xx = cx + dx;
      const yy = cy + dy;
      modules[yy][xx] = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
      reserved[yy][xx] = true;
    }
  }
}

function bchFormatBits(errorCorrectionAndMask: number): number {
  let data = errorCorrectionAndMask << 10;
  const generator = 0x537;
  for (let i = 14; i >= 10; i -= 1) {
    if (((data >>> i) & 1) !== 0) data ^= generator << (i - 10);
  }
  return ((errorCorrectionAndMask << 10) | data) ^ 0x5412;
}

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function drawFormatBits(modules: Cell[][], reserved: boolean[][]) {
  const bits = bchFormatBits((0b01 << 3) | 0);

  for (let i = 0; i <= 5; i += 1) modules[8][i] = getBit(bits, i);
  modules[8][7] = getBit(bits, 6);
  modules[8][8] = getBit(bits, 7);
  modules[7][8] = getBit(bits, 8);
  for (let i = 9; i < 15; i += 1) modules[14 - i][8] = getBit(bits, i);

  for (let i = 0; i < 8; i += 1) modules[SIZE - 1 - i][8] = getBit(bits, i);
  for (let i = 8; i < 15; i += 1) modules[8][SIZE - 15 + i] = getBit(bits, i);

  for (let i = 0; i < SIZE; i += 1) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
}

function createQrMatrix(value: string): boolean[][] {
  const modules = Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));
  const reserved = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));

  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, SIZE - 7, 0);
  drawFinder(modules, reserved, 0, SIZE - 7);
  drawAlignment(modules, reserved, 22, 22);

  for (let i = 8; i < SIZE - 8; i += 1) {
    const black = i % 2 === 0;
    modules[6][i] = black;
    modules[i][6] = black;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  modules[VERSION * 4 + 9][8] = true;
  reserved[VERSION * 4 + 9][8] = true;
  drawFormatBits(modules, reserved);

  const data = encodeData(value);
  const ecc = reedSolomonRemainder(data, reedSolomonDivisor(ECC_CODEWORDS));
  const codewords = [...data, ...ecc];
  const bits = codewords.flatMap((byte) =>
    Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1),
  );

  let bitIndex = 0;
  let upward = true;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < SIZE; vert += 1) {
      const y = upward ? SIZE - 1 - vert : vert;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx;
        if (reserved[y][x]) continue;
        const raw = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        modules[y][x] = raw !== ((x + y) % 2 === 0);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  return modules.map((row) => row.map(Boolean));
}

export function QrCode({ value, label, size = 124, className }: QrCodeProps) {
  const matrix = createQrMatrix(value);
  const quiet = 4;
  const viewBoxSize = SIZE + quiet * 2;
  const cells: React.ReactNode[] = [];

  matrix.forEach((row, y) => {
    row.forEach((black, x) => {
      if (!black) return;
      cells.push(
        <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1} height={1} />,
      );
    });
  });

  return (
    <svg
      role="img"
      aria-label={label ?? value}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill="white" />
      <g fill="black">{cells}</g>
    </svg>
  );
}
