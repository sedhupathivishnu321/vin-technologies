// The 8051 trainer: AT89C51-style core + external data bus devices + on-board I/O.
//   P0 = 8 LEDs, P1 = 8 DIP switches, P2.0-3 stepper, P2.4 relay, P2.5 buzzer, P2.6 DC motor enable, P2.7 DC motor direction,
//   P3.0/P3.1 UART terminal, P3.2/P3.3 INT0/INT1 push buttons, P3.4 T0 pulse generator, P3.5 T1 push button, P3.6/P3.7 LEDs.
//   MOVX map: 8000H 8255 #1 (7-seg + keypad), 9000H 8255 #2 (traffic light, bar LEDs, push buttons), A000H DAC,
//   B000H/B001H ADC data/status, C000H-C003H LCD (cmd / data / status / read data); 0000H-7FFFH is 32 KB RAM.
import { I8051 } from "./i8051.js";
import { Duty, PPI8255, LCD1602, Stepper, SevenSeg, Keypad4x4, DAC, ADC, ToneMeter } from "./devices.js";

export class Kit8051 {
  constructor() {
    this.fosc = 11_059_200;
    this.t = 0;
    this.cpu = new I8051({
      xread: (a) => this.xread(a),
      xwrite: (a, v) => this.xwrite(a, v),
      portWrite: (n, v) => this.portWrite(n, v),
      txByte: (c) => { this.term.push(c); if (this.term.length > 4000) this.term.splice(0, 1000); },
    });
    this.ppi = [new PPI8255("8255 #1"), new PPI8255("8255 #2")];
    this.lcd = new LCD1602();
    this.dac = new DAC();
    this.adc = new ADC();
    this.led = new Duty(8);
    this.led2 = new Duty(2); // P3.6, P3.7
    this.dip = 0;
    this.seg = new SevenSeg(4);
    this.kp = new Keypad4x4();
    this.stepper = new Stepper();
    this.traffic = new Duty(8);
    this.bar = new Duty(8);
    this.pb = 0;
    this.motorEn = new Duty(1);
    this.motorDir = 0;
    this.relay = 0;
    this.relayClicks = 0;
    this.buzz = new ToneMeter();
    this.term = [];
    this.pulse = { on: false, hz: 1000, acc: 0 };
    this.portLog = [];
    this.xLog = [];
    this.wire();
    this.reset();
  }

  wire() {
    const [p1, p2] = this.ppi;
    p1.ext.c = () => {
      const rows = p1.clIn ? 0x0f : (p1.lc & 0x0f);
      return (this.kp.scan(rows) << 4) | 0x0f;
    };
    p1.onChange = (p) => this.seg.drive(p.out.a, p.out.b, this.t);
    p2.ext.c = () => 0xf0 | this.pb;
    p2.onChange = (p) => {
      this.traffic.setMask(p.out.a, this.t);
      this.bar.setMask(p.out.b, this.t);
    };
  }

  reset() {
    const xd = this.cpu.xdata;
    this.cpu.reset();
    this.cpu.ext[1] = this.dip;
    this.t = 0;
    for (const p of this.ppi) p.reset();
    this.lcd.reset();
    this.dac.reset();
    this.adc.reset();
    this.stepper.reset();
    this.led.reset(0); this.led2.reset(0); this.traffic.reset(0); this.bar.reset(0); this.motorEn.reset(0);
    this.seg = Object.assign(new SevenSeg(4), { inv: this.seg ? this.seg.inv : false });
    this.relay = 0;
    this.term = [];
    this.pulse.acc = 0;
    this.cpu.ext[3] = 0xff;
    this.btn = { int0: 0, int1: 0, t1: 0 };
    // P0..P3 latches power up at FFH, so the active-high LEDs on P0/P3 start lit; the P2 loads stay off until the first write
    this.portLog = [];
    this.xLog = [];
    this.portWrite(0, 0xff); this.portWrite(3, 0xff);
    this.stepper.drive(0x0f, 0);
    this.xdata = xd;
  }

  load(bytes, segments) {
    for (const s of segments) for (let a = s.start; a < s.end; a++) this.cpu.code[a] = bytes[a];
  }
  clearMemory() { this.cpu.code.fill(0); this.cpu.xdata.fill(0); }

  portWrite(n, v) {
    this.portLog.push([n, v, this.t]);
    if (this.portLog.length > 6000) this.portLog.splice(0, 2000);
    if (n === 0) this.led.setMask(v, this.t);
    else if (n === 2) {
      this.stepper.drive(v & 15, this.t);
      const r = (v >> 4) & 1;
      if (r !== this.relay) { this.relay = r; this.relayClicks++; }
      this.buzz.set((v >> 5) & 1, this.t);
      this.motorEn.setMask((v >> 6) & 1, this.t);
      this.motorDir = (v >> 7) & 1;
    } else if (n === 3) this.led2.setMask((v >> 6) & 3, this.t);
  }

  xread(a) {
    if (a < 0x8000) return this.cpu.xdata[a];
    const hi = a & 0xf000;
    if (hi === 0x8000) return this.ppi[0].read(a & 3);
    if (hi === 0x9000) return this.ppi[1].read(a & 3);
    if (hi === 0xb000) return (a & 1) ? (this.adc.eoc(this.t) ? 1 : 0) : this.adc.read(this.t);
    if (hi === 0xc000) {
      const r = a & 3;
      return r === 2 ? this.lcd.status(this.t) : r === 3 ? this.lcd.readData(this.t) : 0xff;
    }
    return 0xff;
  }
  xwrite(a, v) {
    if (a < 0x8000) { this.cpu.xdata[a] = v; return; }
    this.xLog.push([a, v, this.t]);
    if (this.xLog.length > 6000) this.xLog.splice(0, 2000);
    const hi = a & 0xf000;
    if (hi === 0x8000) this.ppi[0].write(a & 3, v);
    else if (hi === 0x9000) this.ppi[1].write(a & 3, v);
    else if (hi === 0xa000) this.dac.write(v, this.t);
    else if (hi === 0xb000) this.adc.start(v, this.t);
    else if (hi === 0xc000) { const r = a & 3; if (r === 0) this.lcd.command(v, this.t); else if (r === 1) this.lcd.writeData(v, this.t); }
  }

  // ----- inputs -----
  setDip(mask) { this.dip = mask & 255; this.cpu.ext[1] = this.dip; }
  button(name, down) {
    const c = this.cpu;
    if (name === "int0") c.setPin(3, 2, down ? 0 : 1);
    else if (name === "int1") c.setPin(3, 3, down ? 0 : 1);
    else if (name === "t1") c.setPin(3, 5, down ? 0 : 1);
  }
  typeChar(ch) { this.cpu.rxChar(ch); }

  step() {
    const mc = this.cpu.step();
    const dt = (mc * 12) / this.fosc;
    this.t += dt;
    if (this.pulse.on) {
      this.pulse.acc += dt * this.pulse.hz;
      while (this.pulse.acc >= 1) {
        this.pulse.acc -= 1;
        this.cpu.setPin(3, 4, 0);
        this.cpu.setPin(3, 4, 1);
      }
    }
    return mc;
  }

  /** Runs for `budget` machine cycles. Returns "budget" | "break" | "halt"(never; the 8051 has no HLT). */
  run(budget, breakpoints, skipFirstBreak = false) {
    const c = this.cpu;
    let used = 0, first = skipFirstBreak;
    while (used < budget) {
      if (c.powerDown) return "budget";
      if (!first && breakpoints && breakpoints.has(c.pc) && !c.idle) return "break";
      first = false;
      used += this.step();
    }
    return "budget";
  }
}
