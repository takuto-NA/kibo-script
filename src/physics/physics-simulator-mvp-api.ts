/**
 * 責務: 物理シミュレータMVPでScriptから扱うAPIと、整数スケールの意味を1か所に固定する。
 *
 * 単位型（deg / dps / g）は言語未実装のため、MVPでは整数とコメントで意味を束縛する。
 */

/** 姿勢 roll / pitch / yaw をミリ度（1度 = 1000）で表す。 */
export const IMU_ANGLE_MILLI_DEGREES_PER_DEGREE = 1000;

/** 加速度をミリ g（1g = 1000）で表す。重力は +Y 上向きの世界で Z 軸周りの簡易IMU用に合成する。 */
export const IMU_ACCEL_MILLI_G_PER_G = 1000;

/**
 * MVP Script API（固定筐体ラジコン想定）
 *
 * - `do motor#N.power(percent)` … N は 0 左・1 右。引数は整数または `50%` など既存の percent literal。
 * - `do servo#0.angle(degrees)` … 整数度。将来 `90deg` に寄せる。
 * - `read imu#0.roll` | `pitch` | `yaw` … ミリ度（整数）。
 * - `read imu#0.accel_x` | `accel_y` | `accel_z` … ミリ g（整数）。
 * - `read motor#0` / `read motor#0.power` … 現在の指令パワー（整数パーセント）。
 * - `motor#0.info` / `servo#0.info` / `imu#0.info` … デバッグ用文字列。
 */
