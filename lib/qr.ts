import { encode } from "uqr";

export type QrLogo = {
  /** "data:image/png;base64,...." のような自己完結した data URI。
   * このファイルの呼び出し元（qr-panel.tsx）が組み立てる。 */
  readonly dataUri: string;
};

/**
 * ロゴプレートが QR 全体の幅に占める比率。中心にこの比率の白い正方形
 * （角丸）を置き、その内側にロゴ画像を配置する。誤り訂正 H（最大約30%の
 * モジュール欠損を復元できる）に対し、プレート面積は概ね 0.22^2 ≈ 4.8%
 * にしか達しないので十分な余裕がある。
 */
const LOGO_PLATE_RATIO = 0.22;
const LOGO_IMAGE_RATIO = 0.18;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * uqr の renderSVG (node_modules/uqr/dist/index.mjs) と同形式のSVG文字列を
 * encode() の行列から自前で組み立てる。renderSVG をそのまま使わないのは、
 * 中央にロゴの <image> を合成する機能が uqr 側に無いため。
 *
 * 出力形式は既存の qr-panel.tsx が前提にしていたものと合わせてある —
 * viewBox のみで width/height 属性を付けない（呼び出し側が Tailwind の
 * 任意バリアントでサイズを明示する運用のため）。
 */
export function renderQrSvg(url: string, logo: QrLogo | null): string {
  const pixelSize = 8;
  const border = 2;
  const whiteColor = "#ffffff";
  const blackColor = "#0b0b0b";

  // ロゴで一部のモジュールを覆うぶん、ロゴがあるときだけ誤り訂正を最大の
  // H に引き上げる。常時 H にすると QR が無駄に密になり投影時の読み取り
  // 距離が落ちるため、ロゴなしのときは既存どおり M のままにする。
  const ecc = logo ? "H" : "M";
  const result = encode(url, { ecc, border });

  const width = result.size * pixelSize;
  const height = result.size * pixelSize;

  const paths: string[] = [];
  for (let row = 0; row < result.size; row++) {
    for (let col = 0; col < result.size; col++) {
      if (!result.data[row][col]) continue;
      const x = col * pixelSize;
      const y = row * pixelSize;
      paths.push(`M${x},${y}h${pixelSize}v${pixelSize}h-${pixelSize}z`);
    }
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect fill="${escapeAttr(whiteColor)}" width="${width}" height="${height}"/>`;
  svg += `<path fill="${escapeAttr(blackColor)}" d="${paths.join("")}"/>`;

  if (logo) {
    const plateSize = width * LOGO_PLATE_RATIO;
    const plateOffset = (width - plateSize) / 2;
    const imageSize = width * LOGO_IMAGE_RATIO;
    const imageOffset = (width - imageSize) / 2;
    const plateRadius = plateSize * 0.16;

    // プレートは不透明な白なので、下のモジュールを個別に塗り分ける必要は
    // ない（単純に上から覆い隠す）。
    svg += `<rect x="${plateOffset}" y="${plateOffset}" width="${plateSize}" height="${plateSize}" rx="${plateRadius}" fill="${escapeAttr(whiteColor)}"/>`;
    // dataUri は呼び出し側が自前で base64 エンコードした文字列で、
    // base64 アルファベットのみを含む（属性値を破って脱出できない）。
    // mime も allowlist の固定文字列しか埋め込まれない。
    svg += `<image x="${imageOffset}" y="${imageOffset}" width="${imageSize}" height="${imageSize}" href="${escapeAttr(logo.dataUri)}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  svg += "</svg>";
  return svg;
}
