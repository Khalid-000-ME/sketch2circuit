/**
 * Development boards: what a pin is called, what it can drive, and what it can
 * survive.
 *
 * A board is not a part with two leads. It is a bundle of supply pins and
 * general-purpose pins, and the interesting mistakes are all about the limits of
 * those pins — an LED hung straight on a GPIO, 5V wired into a pin that only
 * tolerates 3.3V. So the limits live here, in one table, where the solver, the
 * rule checks, the symbols and the 3D models can all read the same numbers.
 *
 * The figures are the manufacturers' published ones:
 *   - ATmega328P (Arduino Uno): 40 mA absolute maximum per I/O pin, 20 mA
 *     recommended continuous; I/O pins tolerate up to Vcc + 0.5V.
 *   - Raspberry Pi: 16 mA maximum per GPIO (8 mA is the default drive strength),
 *     GPIO is 3.3V logic and is not 5V tolerant; the 3V3 pin has a ~50 mA budget.
 */

export type BoardType = 'arduino_uno' | 'raspberry_pi';

export const BOARD_TYPES: readonly BoardType[] = ['arduino_uno', 'raspberry_pi'];
export const isBoardType = (t: string): t is BoardType => (BOARD_TYPES as readonly string[]).includes(t);

export type PinState = 'high' | 'low' | 'input';

interface PowerPin {
  volts: number;
  /** Output resistance of the supply, ohms. */
  rint: number;
  /** The most it can deliver before something gives, amps. */
  maxA: number;
}

export interface BoardSpec {
  type: BoardType;
  name: string;
  /** Logic high level, volts. */
  logicV: number;
  /** Output resistance of a driven GPIO, ohms. */
  gpioRout: number;
  /** Above this a pin is working harder than it should, amps. */
  gpioWarnA: number;
  /** Above this a pin is being damaged, amps. */
  gpioMaxA: number;
  /** Highest voltage a pin tolerates before damage, volts. */
  gpioMaxV: number;
  /** Why those limits are what they are, for the message a person reads. */
  limitNote: string;
  power: Record<string, PowerPin>;
  gpio: readonly string[];
  /** Which pins sit on which side of the schematic symbol, top to bottom. */
  symbol: { title: string; left: readonly string[]; right: readonly string[] };
}

const range = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

const ARDUINO_DIGITAL = range(14, (i) => `D${i}`);
const ARDUINO_ANALOG = range(6, (i) => `A${i}`);
const PI_GPIO = range(26, (i) => `GPIO${i + 2}`);

export const BOARDS: Record<BoardType, BoardSpec> = {
  arduino_uno: {
    type: 'arduino_uno',
    name: 'Arduino Uno',
    logicV: 5,
    gpioRout: 40,
    gpioWarnA: 0.02,
    gpioMaxA: 0.04,
    gpioMaxV: 5.5,
    limitNote: 'The ATmega328P allows 40 mA per pin at the absolute most and recommends staying under 20 mA.',
    power: {
      '5V': { volts: 5, rint: 0.5, maxA: 0.5 },
      '3V3': { volts: 3.3, rint: 1, maxA: 0.15 },
    },
    gpio: [...ARDUINO_DIGITAL, ...ARDUINO_ANALOG],
    symbol: {
      title: 'ARDUINO UNO',
      left: ['RESET', '3V3', '5V', 'VIN', 'GND', ...ARDUINO_ANALOG],
      right: ARDUINO_DIGITAL,
    },
  },
  raspberry_pi: {
    type: 'raspberry_pi',
    name: 'Raspberry Pi',
    logicV: 3.3,
    gpioRout: 50,
    gpioWarnA: 0.008,
    gpioMaxA: 0.016,
    gpioMaxV: 3.6,
    limitNote: 'A Raspberry Pi GPIO pin is rated for 16 mA at the most, and 8 mA is its default drive strength.',
    power: {
      '3V3': { volts: 3.3, rint: 2, maxA: 0.05 },
      '5V': { volts: 5, rint: 0.5, maxA: 1.0 },
    },
    gpio: PI_GPIO,
    symbol: {
      title: 'RASPBERRY PI',
      left: ['3V3', '5V', 'GND', ...PI_GPIO.slice(0, 12)],
      right: PI_GPIO.slice(12),
    },
  },
};

export const ARDUINO_UNO_PINS = ['RESET', '3V3', '5V', 'VIN', 'GND', ...ARDUINO_DIGITAL, ...ARDUINO_ANALOG] as const;
export const RASPBERRY_PI_PINS = ['3V3', '5V', 'GND', ...PI_GPIO] as const;

/** The 40-pin header by physical position, as printed on every pinout diagram. */
export const PI_PHYSICAL: Record<number, string> = {
  1: '3V3', 2: '5V', 3: 'GPIO2', 4: '5V', 5: 'GPIO3', 6: 'GND', 7: 'GPIO4', 8: 'GPIO14',
  9: 'GND', 10: 'GPIO15', 11: 'GPIO17', 12: 'GPIO18', 13: 'GPIO27', 14: 'GND', 15: 'GPIO22',
  16: 'GPIO23', 17: '3V3', 18: 'GPIO24', 19: 'GPIO10', 20: 'GND', 21: 'GPIO9', 22: 'GPIO25',
  23: 'GPIO11', 24: 'GPIO8', 25: 'GND', 26: 'GPIO7', 27: 'ID_SD', 28: 'ID_SC', 29: 'GPIO5',
  30: 'GND', 31: 'GPIO6', 32: 'GPIO12', 33: 'GPIO13', 34: 'GND', 35: 'GPIO19', 36: 'GPIO16',
  37: 'GPIO26', 38: 'GPIO20', 39: 'GND', 40: 'GPIO21',
};

/**
 * Turns whatever was written next to a board's pin into the pin it names, or null.
 *
 * Null, not a guess. Every other part falls back to its first pin when a name is
 * unrecognised, which is harmless on a resistor and wrong on a board: silently
 * wiring "D99" to RESET is a worse answer than saying the pin does not exist.
 */
export function normaliseBoardPin(type: BoardType, raw: string): string | null {
  const s = String(raw).toLowerCase().replace(/[\s_.\-~]+/g, '').replace(/^pin/, '');
  if (!s) return null;

  if (/^(gnd|ground|0v|gnd\d)$/.test(s)) return 'GND';
  if (/^(5v|\+5v|vcc|5vout|v5)$/.test(s)) return '5V';
  if (/^(3v3|3\.3v|\+3v3|33v|3v|v33|3v3out)$/.test(s)) return '3V3';

  if (type === 'arduino_uno') {
    if (/^(vin|vi)$/.test(s)) return 'VIN';
    if (/^(reset|rst)$/.test(s)) return 'RESET';
    let m = s.match(/^a(?:nalog)?([0-5])$/);
    if (m) return `A${m[1]}`;
    m = s.match(/^d(?:igital)?(\d{1,2})$/) ?? s.match(/^(\d{1,2})$/);
    if (m) {
      const n = Number(m[1]);
      if (n <= 13) return `D${n}`;
      if (n >= 14 && n <= 19) return `A${n - 14}`; // the analog pins double as D14 to D19
    }
    return null;
  }

  // Raspberry Pi. A bare number is a BCM GPIO number; "pin 11" is a physical position.
  const physical = String(raw).toLowerCase().match(/^\s*(?:pin|physical|p)\s*[_\-]?\s*(\d{1,2})\s*$/);
  if (physical) {
    const name = PI_PHYSICAL[Number(physical[1])];
    return name && name.startsWith('GPIO') ? name : name === '3V3' || name === '5V' || name === 'GND' ? name : null;
  }
  const m = s.match(/^(?:gpio|bcm|gp|io)?(\d{1,2})$/);
  if (m) {
    const n = Number(m[1]);
    return n >= 2 && n <= 27 ? `GPIO${n}` : null;
  }
  return null;
}

/** Whether a pin on a board can be driven, as opposed to being power or ground. */
export const isGpio = (type: BoardType, pin: string) => BOARDS[type].gpio.includes(pin);
