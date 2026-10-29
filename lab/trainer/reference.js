// Quick-reference pages shown in the "Reference" tab.
const t = (head, rows) => `<table class="t"><thead><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

const SYNTAX = `<h5>Assembler syntax</h5>
<p>Labels end with a colon. Comments start with <code>;</code>. Numbers: <code>0FFH</code>, <code>0xFF</code>, <code>1010B</code>, <code>255</code>, <code>'A'</code>. A number that starts with a letter needs a leading 0 (<code>0A5H</code>). Expressions allow <code>+ - * / % &amp; | ^ ~ &lt;&lt; &gt;&gt;</code>, <code>HIGH(x)</code>, <code>LOW(x)</code> and <code>$</code> (current address).</p>
<p>Directives: <code>ORG</code>, <code>EQU</code>, <code>DB</code> (bytes and "strings"), <code>DW</code>, <code>DS</code> (reserve), <code>END</code>.</p>`;

export const REFERENCE = {
  8085: `<h3>8085 trainer reference</h3>
${SYNTAX}
<h5>Memory</h5>
<p>The whole 64 KB space is RAM so vectors can be programmed directly (reset 0000H, TRAP 0024H, RST 5.5 002CH, RST 6.5 0034H, RST 7.5 003CH, RST n at 8 x n). Programs normally start at 2000H and are started with <b>GO 2000 EXEC</b> or the Run button. A program that begins with <code>ORG 0000H / JMP START</code> also starts at reset.</p>
<h5>I/O map</h5>
${t(["Ports", "Device", "Connected to"], [
    ["00H-03H", "8255 #1 (A, B, C, control)", "PA: 8 LEDs, PB: 8 DIP switches, PC0-3: push buttons"],
    ["10H-13H", "8255 #2", "PA: segments a-g,dp; PB: 8 digit selects; PC0-3 keypad rows (out), PC4-7 keypad columns (in)"],
    ["20H-23H", "8255 #3", "PA0-3 stepper, PA4 relay, PA5 buzzer; PB0-5 traffic lights; PC0 motor enable, PC1 direction"],
    ["30H", "DAC (8-bit)", "0-5 V output on the scope"],
    ["40H / 41H", "ADC0809", "write 40H: channel + start; read 40H: data; read 41H bit 0: EOC"],
    ["50H-53H", "8253 timer", "counters 0-2 and control; clock 1.5 MHz; OUT0 to RST 6.5 (jumper), OUT1 speaker, OUT2 LED"],
    ["60H / 61H", "8251 USART", "data / control and status; terminal in the panel"],
    ["70H / 71H", "LCD 16x2", "command and status / data"],
  ])}
<h5>8255 control words</h5>
${t(["Word", "Meaning"], [["80H", "mode 0, A B C all outputs"], ["82H", "A output, B input, C output"], ["90H", "A input, B C output"], ["88H", "A, B, C lower output, C upper input"], ["9BH", "all inputs (reset state)"], ["BSR", "bit 7 = 0: bits 3-1 select the C bit, bit 0 sets or clears it"]])}
<h5>Monitor service routines (CALL these)</h5>
${t(["Address", "Name", "Action"], [["0300H", "GETKEY", "wait for a key; code in A (0-F digits, 10H EXEC, 11H NEXT, 12H PREV, 13H EXAM, 14H REG, 15H GO, 16H STEP)"], ["0303H", "RDKBD", "A = key or FFH if none"], ["0306H", "UPDAD", "show HL on the four address digits"], ["0309H", "UPDDT", "show A on the two data digits"], ["030CH", "CLEAR", "blank the display"], ["030FH", "DELAY", "delay of BC milliseconds"], ["0312H", "BEEP", "short beep"]])}
<h5>Timing</h5>
<p>CPU clock 3 MHz: one T-state is 0.333 us. MOV r,r 4 T, MVI r 7 T, LDA 13 T, JMP 10 T, CALL 18 T, DCX 6 T. Run at speed "Real time 1x" to see delay loops take their real time.</p>
<h5>Interrupts</h5>
${t(["Input", "Vector", "Trigger", "Masked by"], [["TRAP", "0024H", "edge + level", "never"], ["RST 7.5", "003CH", "rising edge (latched)", "EI/DI, SIM bit 2"], ["RST 6.5", "0034H", "level", "EI/DI, SIM bit 1"], ["RST 5.5", "002CH", "level", "EI/DI, SIM bit 0"], ["INTR", "from the instruction supplied", "level", "EI/DI"]])}
<p>SIM: bit 3 MSE enables the mask bits, bit 4 resets the RST 7.5 latch, bit 6 SOE enables SOD, bit 7 = SOD. RIM returns SID in bit 7, pending flags in bits 6-4, IE in bit 3, masks in bits 2-0.</p>
<h5>Not emulated</h5><p>8255 modes 1 and 2, 8253 BCD counting, the 8279 keyboard/display controller, the 8259 interrupt controller.</p>`,

  8051: `<h3>8051 trainer reference</h3>
${SYNTAX}
<p>8051 specific: <code>#</code> immediate, <code>@R0</code> / <code>@R1</code> indirect, bit addresses such as <code>P1.3</code>, <code>ACC.7</code>, <code>20H.5</code>, <code>/bit</code> complemented bit. Pseudo-ops: <code>DATA</code>, <code>BIT</code>, <code>CODE</code>, <code>XDATA</code>, <code>IDATA</code>, <code>EQU</code>. <code>JMP label</code> assembles to LJMP and <code>CALL label</code> to LCALL. All SFR and bit names (TMOD, TR0, TF0, EA, ...) are predefined, so do not use them as labels.</p>
<h5>On-board connections</h5>
${t(["Pin", "Connected to"], [["P0", "8 LEDs (1 = lit)"], ["P1", "8 DIP switches (write FFH first when reading)"], ["P2.0-P2.3", "stepper motor"], ["P2.4 / P2.5", "relay / buzzer"], ["P2.6 / P2.7", "DC motor enable / direction"], ["P3.0 / P3.1", "UART terminal (RXD / TXD)"], ["P3.2 / P3.3", "INT0 / INT1 push buttons (active low)"], ["P3.4", "T0 pulse generator"], ["P3.5", "T1 push button"], ["P3.6 / P3.7", "2 spare LEDs"]])}
<h5>External data space (MOVX)</h5>
${t(["Address", "Device"], [["0000H-7FFFH", "32 KB RAM"], ["8000H-8003H", "8255 #1: PA segments, PB digit select, PC keypad"], ["9000H-9003H", "8255 #2: PA0-5 traffic light, PB bar LEDs, PC0-3 push buttons"], ["A000H", "DAC"], ["B000H / B001H", "ADC0809: write = channel + start, read = data / EOC in bit 0"], ["C000H-C003H", "LCD: C000 command, C001 data, C002 status, C003 read data"]])}
<h5>Timers and serial</h5>
<p>Machine cycle = 12 / f<sub>osc</sub> (1.085 us at 11.0592 MHz). TMOD: bits 7-4 timer 1, bits 3-0 timer 0 (GATE, C/T, M1 M0). Modes: 0 13-bit, 1 16-bit, 2 8-bit auto-reload, 3 split timer 0. 9600 baud: <code>TMOD=20H, TH1=FDH, SCON=50H, SETB TR1</code>.</p>
<h5>Interrupt vectors</h5>
${t(["Source", "Vector", "Enable bit", "Priority bit"], [["INT0", "0003H", "EX0 (IE.0)", "PX0"], ["Timer 0", "000BH", "ET0 (IE.1)", "PT0"], ["INT1", "0013H", "EX1 (IE.2)", "PX1"], ["Timer 1", "001BH", "ET1 (IE.3)", "PT1"], ["Serial", "0023H", "ES (IE.4)", "PS"]])}
<p>EA (IE.7) must also be set. A high-priority interrupt can interrupt a low-priority ISR. RETI ends an ISR.</p>
<h5>Instruction timing</h5>
<p>Most instructions take 1 or 2 machine cycles; MUL AB and DIV AB take 4. The Cycles counter in the CPU tab counts them exactly.</p>
<h5>Not emulated</h5><p>Timer 2 (8052), external code memory timing, power-down wake-up by reset only, ALE/PSEN pins.</p>`,
};
