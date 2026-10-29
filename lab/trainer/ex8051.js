// 8051 experiments (11.0592 MHz crystal: 1 machine cycle = 1.085 us). check() runs in the test-suite and the "Check result" button.
const hx = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, "0");
const res = (ok, msg) => ({ ok, msg });
const iram = (k, a) => k.cpu.iram[a];
const setI = (k, a, bytes) => bytes.forEach((b, i) => (k.cpu.iram[a + i] = b));
const sine32 = Array.from({ length: 32 }, (_, i) => Math.round(127.5 + 127 * Math.sin((2 * Math.PI * i) / 32)));
const h0 = (v) => "0" + hx(v) + "H";
const dbList = (a) => a.map(h0).join(",");
const p0log = (k) => k.portLog.filter((e) => e[0] === 0).map((e) => e[1]);
const DLY = (name, outer, inner) => `${name}:   MOV R7,#${outer}\n${name}1:  MOV R6,#${inner}\n${name}2:  DJNZ R6,${name}2\n        DJNZ R7,${name}1\n        RET`;
const LCDLIB = `LCMD:   MOV R5,A         ; A = command byte
LC1:    MOV DPTR,#0C002H
        MOVX A,@DPTR    ; read status
        JB  ACC.7,LC1   ; wait while busy
        MOV DPTR,#0C000H
        MOV A,R5
        MOVX @DPTR,A
        RET
LDAT:   MOV R5,A         ; A = character
LD1:    MOV DPTR,#0C002H
        MOVX A,@DPTR
        JB  ACC.7,LD1
        MOV DPTR,#0C001H
        MOV A,R5
        MOVX @DPTR,A
        RET
LINIT:  MOV A,#38H      ; 8-bit, 2 lines
        ACALL LCMD
        MOV A,#0CH      ; display on
        ACALL LCMD
        MOV A,#06H      ; entry mode
        ACALL LCMD
        MOV A,#01H      ; clear
        ACALL LCMD
        RET
LSTR:   CLR A           ; print zero-terminated string at DPTR
        MOVC A,@A+DPTR
        JZ  LS2
        PUSH DPH
        PUSH DPL
        ACALL LDAT
        POP DPL
        POP DPH
        INC DPTR
        SJMP LSTR
LS2:    RET`;
const lcdRows = (k) => k.lcd.view().map((r) => r.map((c) => String.fromCharCode(c)).join(""));

export const EX8051 = [
  // ------------------------------------------------------------------ arithmetic
  {
    id: "a-add8", group: "Arithmetic programs", title: "Add two 8-bit numbers",
    aim: "Add the bytes in internal RAM 30H and 31H; sum to 32H, carry to 33H.",
    theory: "ADD A,direct adds a memory byte to the accumulator and sets CY (carry), AC and OV. ADDC adds the carry back in, so CLR A / ADDC A,#0 captures CY as a byte.",
    steps: ["F5H and 0CH are preloaded in 30H/31H.", "Run, then read 32H/33H in the Internal RAM view.", "Single-step and watch ACC and PSW."],
    questions: ["Which PSW flags are set after F5H + 0CH?", "What does the OV flag mean?"],
    code: `        ORG 0000H
        MOV A,30H
        ADD A,31H
        MOV 32H,A       ; sum
        CLR A
        ADDC A,#00H     ; A = carry
        MOV 33H,A
        SJMP $`,
    setup: (k) => setI(k, 0x30, [0xf5, 0x0c]),
    run: 200,
    check: (k) => res(iram(k, 0x32) === 1 && iram(k, 0x33) === 1, `sum=${hx(iram(k, 0x32))}H carry=${iram(k, 0x33)}`),
  },
  {
    id: "a-add16", group: "Arithmetic programs", title: "16-bit addition",
    aim: "Add 16-bit numbers at 30H-31H and 32H-33H (low byte first); result to 34H-36H.",
    theory: "The low bytes are added with ADD and the high bytes with ADDC so that the carry from the low byte propagates. A final ADDC captures the carry out of bit 15.",
    steps: ["F234H + 1B78H is preloaded.", "Run: 34H-36H = AC 0D 01.", "Change the data so no carry occurs."],
    questions: ["Why ADDC for the upper byte?", "How would you add 32-bit numbers?"],
    code: `        ORG 0000H
        MOV A,30H
        ADD A,32H
        MOV 34H,A
        MOV A,31H
        ADDC A,33H
        MOV 35H,A
        CLR A
        ADDC A,#00H
        MOV 36H,A
        SJMP $`,
    setup: (k) => setI(k, 0x30, [0x34, 0xf2, 0x78, 0x1b]),
    run: 200,
    check: (k) => res(iram(k, 0x34) === 0xac && iram(k, 0x35) === 0x0d && iram(k, 0x36) === 1, `result ${iram(k, 0x36)}:${hx(iram(k, 0x35))}${hx(iram(k, 0x34))}H`),
  },
  {
    id: "a-sub", group: "Arithmetic programs", title: "Subtraction with borrow",
    aim: "Compute [30H] - [31H]; difference to 32H and borrow to 33H.",
    theory: "SUBB subtracts the operand and the carry flag, so CLR C must precede the first subtraction. CY = 1 after SUBB means a borrow (negative result in 2's complement).",
    steps: ["05H - 0AH is preloaded.", "Run: 32H = FBH, 33H = 1.", "Try 0AH - 05H."],
    questions: ["Why is CLR C needed first?", "What is FBH as a signed number?"],
    code: `        ORG 0000H
        MOV A,30H
        CLR C
        SUBB A,31H
        MOV 32H,A
        CLR A
        ADDC A,#00H     ; borrow flag
        MOV 33H,A
        SJMP $`,
    setup: (k) => setI(k, 0x30, [0x05, 0x0a]),
    run: 200,
    check: (k) => res(iram(k, 0x32) === 0xfb && iram(k, 0x33) === 1, `diff=${hx(iram(k, 0x32))}H borrow=${iram(k, 0x33)}`),
  },
  {
    id: "a-mul", group: "Arithmetic programs", title: "Multiplication with MUL AB",
    aim: "Multiply [30H] by [31H]; 16-bit product to 32H (low) and 33H (high).",
    theory: "MUL AB multiplies A by B in one instruction (4 machine cycles); the low byte of the product is left in A and the high byte in B. OV is set if the product exceeds 255.",
    steps: ["200 x 100 is preloaded: 4E20H.", "Run and read 32H/33H.", "Check OV in PSW."],
    questions: ["How long does MUL AB take at 12 MHz?", "Which flag shows that B is non-zero?"],
    code: `        ORG 0000H
        MOV A,30H
        MOV B,31H
        MUL AB
        MOV 32H,A       ; low byte
        MOV 33H,B       ; high byte
        SJMP $`,
    setup: (k) => setI(k, 0x30, [200, 100]),
    run: 200,
    check: (k) => res(iram(k, 0x32) === 0x20 && iram(k, 0x33) === 0x4e, `product=${hx(iram(k, 0x33))}${hx(iram(k, 0x32))}H (expected 4E20H)`),
  },
  {
    id: "a-div", group: "Arithmetic programs", title: "Division with DIV AB",
    aim: "Divide [30H] by [31H]; quotient to 32H and remainder to 33H; flag divide-by-zero.",
    theory: "DIV AB divides A by B; the quotient stays in A and the remainder goes to B. Dividing by zero sets OV.",
    steps: ["100 / 7 is preloaded.", "Run: Q = 0EH, R = 02H.", "Set the divisor to 0 and see 32H = FFH."],
    questions: ["What does OV indicate after DIV AB?", "How would you get a decimal fraction?"],
    code: `        ORG 0000H
        MOV A,30H
        MOV B,31H
        DIV AB
        JB  OV,ERR
        MOV 32H,A
        MOV 33H,B
        SJMP $
ERR:    MOV 32H,#0FFH
        SJMP $`,
    setup: (k) => setI(k, 0x30, [100, 7]),
    run: 200,
    check: (k) => res(iram(k, 0x32) === 14 && iram(k, 0x33) === 2, `Q=${iram(k, 0x32)} R=${iram(k, 0x33)}`),
  },
  {
    id: "a-bcd", group: "Arithmetic programs", title: "BCD addition with DA A",
    aim: "Add packed-BCD bytes 30H and 31H; sum to 32H, carry to 33H.",
    theory: "After ADD of two BCD bytes, DA A corrects each nibble that is above 9 (or has produced a carry), returning valid BCD.",
    steps: ["59 + 47 is preloaded.", "Run: 33H:32H = 1:06 -> 106.", "Watch ACC before and after DA A."],
    questions: ["What does AC record?", "Why is there no DA instruction for subtraction?"],
    code: `        ORG 0000H
        MOV A,30H
        ADD A,31H
        DA  A
        MOV 32H,A
        CLR A
        ADDC A,#00H
        MOV 33H,A
        SJMP $`,
    setup: (k) => setI(k, 0x30, [0x59, 0x47]),
    run: 200,
    check: (k) => res(iram(k, 0x32) === 0x06 && iram(k, 0x33) === 1, `BCD ${iram(k, 0x33)}${hx(iram(k, 0x32))}`),
  },
  {
    id: "a-bin2bcd", group: "Arithmetic programs", title: "Binary to decimal digits",
    aim: "Split the byte at 30H into hundreds (31H), tens (32H) and units (33H).",
    theory: "Dividing by 100 gives the hundreds digit and leaves a remainder in B. Dividing that remainder by 10 gives tens (A) and units (B).",
    steps: ["156 is preloaded.", "Run: 31H-33H = 1, 5, 6.", "Add ASCII conversion with ORL A,#30H."],
    questions: ["How many DIV instructions for a 16-bit value?", "How would you display the digits on 7-segment displays?"],
    code: `        ORG 0000H
        MOV A,30H
        MOV B,#100
        DIV AB
        MOV 31H,A       ; hundreds
        MOV A,B
        MOV B,#10
        DIV AB
        MOV 32H,A       ; tens
        MOV 33H,B       ; units
        SJMP $`,
    setup: (k) => setI(k, 0x30, [156]),
    run: 200,
    check: (k) => res([iram(k, 0x31), iram(k, 0x32), iram(k, 0x33)].join() === "1,5,6", `digits ${iram(k, 0x31)}${iram(k, 0x32)}${iram(k, 0x33)}`),
  },
  // ------------------------------------------------------------------ data handling
  {
    id: "b-largest", group: "Data handling", title: "Largest number in an array",
    aim: "Count at 30H, array from 31H; the largest value goes to 50H.",
    theory: "Indirect addressing with @R0 walks through the array. SUBB sets CY when the accumulator is smaller than the element, so JNC keeps the larger value.",
    steps: ["Six numbers are preloaded.", "Run and read 50H.", "Change the loop to find the smallest."],
    questions: ["Why can R0/R1 only address internal RAM?", "What does CLR C do before SUBB?"],
    code: `        ORG 0000H
        MOV R0,#30H
        MOV A,@R0
        MOV R2,A        ; count
        INC R0
        MOV A,@R0       ; first element
        DEC R2
LP:     INC R0
        MOV R3,A
        CLR C
        SUBB A,@R0      ; A - M
        MOV A,R3
        JNC KEEP        ; A >= M
        MOV A,@R0
KEEP:   DJNZ R2,LP
        MOV 50H,A
        SJMP $`,
    setup: (k) => setI(k, 0x30, [6, 0x12, 0xa5, 0x3c, 0xf0, 0x07, 0x80]),
    run: 400,
    check: (k) => res(iram(k, 0x50) === 0xf0, `largest=${hx(iram(k, 0x50))}H`),
  },
  {
    id: "b-sort", group: "Data handling", title: "Bubble sort",
    aim: "Sort the n bytes starting at 31H (count at 30H) in ascending order.",
    theory: "Neighbouring elements are compared with CJNE (which sets CY if the first is smaller) and swapped when out of order. After pass k the k largest elements are in place.",
    steps: ["25 12 09 FF 03 40 is preloaded.", "Run and read 31H-36H.", "Change JC to JNC for descending order."],
    questions: ["How many passes are needed for n elements?", "What does MOV B,@R0 assemble to?"],
    code: `        ORG 0000H
        MOV A,30H
        DEC A
        JZ  FIN
        MOV R2,A        ; passes
PASS:   MOV R0,#31H
        MOV A,R2
        MOV R3,A        ; comparisons this pass
CMPL:   MOV A,@R0
        INC R0
        MOV B,@R0       ; next element
        CJNE A,B,NE
        SJMP NOSW
NE:     JC  NOSW        ; A < B
        MOV @R0,A       ; swap
        DEC R0
        MOV @R0,B
        INC R0
NOSW:   DJNZ R3,CMPL
        DJNZ R2,PASS
FIN:    SJMP $`,
    setup: (k) => setI(k, 0x30, [6, 0x25, 0x12, 0x09, 0xff, 0x03, 0x40]),
    run: 5000,
    check: (k) => { const g = Array.from({ length: 6 }, (_, i) => iram(k, 0x31 + i)); return res(g.join() === [3, 9, 0x12, 0x25, 0x40, 0xff].join(), `array=${g.map((v) => hx(v)).join(" ")}`); },
  },
  {
    id: "b-move", group: "Data handling", title: "Block move to external RAM (MOVX)",
    aim: "Copy 8 bytes from internal RAM 30H to external RAM 0100H.",
    theory: "External data memory is reached with MOVX through DPTR (16-bit address) or @Ri. Internal RAM is read with @R0, so each byte is moved via the accumulator.",
    steps: ["Eight bytes are preloaded at 30H.", "Run and look at External RAM page 0100H.", "Move back from external to internal."],
    questions: ["Why can't MOV copy directly into external RAM?", "How many address lines does DPTR give?"],
    code: `        ORG 0000H
        MOV R0,#30H
        MOV DPTR,#0100H
        MOV R2,#08H
LP:     MOV A,@R0
        MOVX @DPTR,A
        INC R0
        INC DPTR
        DJNZ R2,LP
        SJMP $`,
    setup: (k) => setI(k, 0x30, [1, 2, 3, 4, 5, 6, 7, 8].map((v) => v * 0x11)),
    run: 400,
    check: (k) => res([0, 1, 2, 3, 4, 5, 6, 7].every((i) => k.cpu.xdata[0x100 + i] === (i + 1) * 0x11), "external RAM equals the source block"),
  },
  {
    id: "b-ones", group: "Data handling", title: "Count the 1s in a byte",
    aim: "Count the set bits of [30H] into 31H and store the parity bit in 32H.",
    theory: "RRC A rotates through the carry flag, so each of the eight bits appears in CY once. JNC skips the increment for zeros.",
    steps: ["B7H is preloaded (6 ones).", "Run and read 31H/32H.", "Compare with the P flag in PSW."],
    questions: ["What does the hardware P flag report?", "How could a look-up table speed this up?"],
    code: `        ORG 0000H
        MOV A,30H
        MOV R2,#08H
        MOV R3,#00H
LP:     RRC A
        JNC SK
        INC R3
SK:     DJNZ R2,LP
        MOV 31H,R3
        MOV A,R3
        ANL A,#01H
        MOV 32H,A       ; 1 = odd parity
        SJMP $`,
    setup: (k) => setI(k, 0x30, [0xb7]),
    run: 400,
    check: (k) => res(iram(k, 0x31) === 6 && iram(k, 0x32) === 0, `ones=${iram(k, 0x31)} parity=${iram(k, 0x32)}`),
  },
  {
    id: "b-bits", group: "Data handling", title: "Bit-addressable RAM and the carry flag",
    aim: "Set, clear and complement individual bits of RAM byte 20H and copy a bit through the carry flag.",
    theory: "Internal RAM 20H-2FH is bit addressable (bit addresses 00H-7FH). SETB, CLR and CPL act on single bits; MOV C,bit and MOV bit,C move a bit through the carry, and ORL C,/bit combines it with an inverted bit.",
    steps: ["Run: 20H becomes 88H and bit 08H (21H.0) becomes 1.", "Single-step and watch the bit-addressable view.", "Predict the result before running."],
    questions: ["What is the bit address of 22H.5?", "What does the slash in ORL C,/bit do?"],
    code: `        ORG 0000H
        MOV 20H,#00H
        SETB 20H.0
        SETB 20H.7
        CPL 20H.3
        CLR 20H.0
        MOV C,20H.7
        MOV 21H.0,C     ; copy bit 7 of 20H into bit 0 of 21H
        ORL C,/20H.0    ; C = C OR NOT 20H.0
        MOV A,20H
        MOV 30H,A
        MOV 31H,21H
        SJMP $`,
    run: 200,
    check: (k) => res(iram(k, 0x30) === 0x88 && iram(k, 0x31) === 0x01, `20H=${hx(iram(k, 0x30))}H, 21H=${hx(iram(k, 0x31))}H`),
  },
  {
    id: "b-lut", group: "Data handling", title: "Look-up table with MOVC",
    aim: "Return the square of the digit in 30H from a code-memory table into 31H.",
    theory: "MOVC A,@A+DPTR reads a constant from program memory. The table label is loaded into DPTR and the index sits in A.",
    steps: ["Digit 7 is preloaded.", "Run: 31H = 31H (49).", "Extend the table."],
    questions: ["Why can't MOV read code memory?", "What does MOVC A,@A+PC do differently?"],
    code: `        ORG 0000H
        MOV A,30H
        MOV DPTR,#TAB
        MOVC A,@A+DPTR
        MOV 31H,A
        SJMP $
TAB:    DB 0,1,4,9,16,25,36,49,64,81`,
    setup: (k) => setI(k, 0x30, [7]),
    run: 200,
    check: (k) => res(iram(k, 0x31) === 49, `square=${iram(k, 0x31)}`),
  },
  {
    id: "b-bank", group: "Data handling", title: "Register banks and the stack",
    aim: "Use two register banks (RS0) and exchange values through PUSH/POP.",
    theory: "R0-R7 map onto one of four 8-byte banks of internal RAM selected by PSW.4/PSW.3. Switching banks gives a fast context switch. PUSH/POP use the stack at SP+1 (default SP = 07H, so move SP before using banks 1-3).",
    steps: ["Run: 30H = 22H, 31H = 11H.", "Watch RAM 00H-0FH while stepping.", "Use bank 2 as well."],
    questions: ["What is the RAM address of R3 in bank 2?", "Why is SP set to 50H first?"],
    code: `        ORG 0000H
        MOV SP,#50H
        MOV R0,#11H     ; bank 0: address 00H
        SETB RS0        ; select bank 1
        MOV R0,#22H     ; bank 1: address 08H
        CLR RS0
        PUSH 00H        ; push bank-0 R0
        PUSH 08H        ; push bank-1 R0
        POP  30H        ; last in, first out
        POP  31H
        SJMP $`,
    run: 200,
    check: (k) => res(iram(k, 0x30) === 0x22 && iram(k, 0x31) === 0x11 && iram(k, 0) === 0x11 && iram(k, 8) === 0x22, `30H=${hx(iram(k, 0x30))}H 31H=${hx(iram(k, 0x31))}H`),
  },
  {
    id: "b-ascii", group: "Data handling", title: "Hex byte to ASCII",
    aim: "Convert the byte at 30H into two ASCII characters at 31H and 32H.",
    theory: "ADD A,#90H followed by DA A and ADDC A,#40H followed by DA A converts a nibble 0-F to its ASCII code without a branch, using the decimal-adjust to add 07H for letters.",
    steps: ["5CH is preloaded.", "Run: 31H = 35H ('5'), 32H = 43H ('C').", "Step through the trick and note ACC."],
    questions: ["Why does the trick work?", "How would you handle lower-case letters?"],
    code: `        ORG 0000H
        MOV A,30H
        MOV R2,A
        SWAP A
        ACALL ASC
        MOV 31H,A
        MOV A,R2
        ACALL ASC
        MOV 32H,A
        SJMP $
ASC:    ANL A,#0FH
        ADD A,#90H
        DA  A
        ADDC A,#40H
        DA  A
        RET`,
    setup: (k) => setI(k, 0x30, [0x5c]),
    run: 300,
    check: (k) => res(iram(k, 0x31) === 0x35 && iram(k, 0x32) === 0x43, `chars ${hx(iram(k, 0x31))} ${hx(iram(k, 0x32))}`),
  },
  // ------------------------------------------------------------------ timers, interrupts, serial
  {
    id: "t-delay", group: "Timers, interrupts and serial", title: "Timer 0 delay: 0.5 s LED blink",
    aim: "Generate 50 ms with Timer 0 in mode 1 (polling TF0) and use ten of them to blink P0.0 every 0.5 s.",
    theory: "At 11.0592 MHz one machine cycle is 1.085 us, so 50 ms is 46080 cycles. Timer 0 counts up and sets TF0 when it overflows past FFFFH, so it is loaded with 65536 - 46080 = 4C00H. TF0 must be cleared by software.",
    steps: ["Run at 1x and watch LED 0.", "Change R7 to 20 for a 1 s toggle.", "Compute the load value for 10 ms."],
    questions: ["What load value gives 1 ms?", "What happens if TF0 is not cleared?"],
    code: `        ORG 0000H
        MOV TMOD,#01H   ; timer 0, mode 1
BLINK:  CPL P0.0
        MOV R7,#10
LP:     MOV TH0,#4CH    ; 65536 - 46080
        MOV TL0,#00H
        SETB TR0
        JNB TF0,$       ; wait for overflow
        CLR TR0
        CLR TF0
        DJNZ R7,LP
        SJMP BLINK`,
    run: 2.6e6,
    check: (k) => { const o = p0log(k); let tg = 0; for (let i = 1; i < o.length; i++) if ((o[i] ^ o[i - 1]) & 1) tg++; const t = k.portLog.filter((e) => e[0] === 0).map((e) => e[2]); const dt = t.length > 2 ? t[2] - t[1] : 0; return res(tg >= 4 && Math.abs(dt - 0.5) < 0.02, `${tg} toggles, period ${dt.toFixed(3)} s (expected 0.500 s)`); },
  },
  {
    id: "t-tone", group: "Timers, interrupts and serial", title: "Timer 0 mode 2: 2 kHz buzzer tone",
    aim: "Use Timer 0 in auto-reload mode (mode 2) to toggle the buzzer at P2.5 every 250 us.",
    theory: "Mode 2 is an 8-bit timer that reloads from TH0 each time it overflows. A count of 230 machine cycles is 250 us, so TH0 = 256 - 230 = 26. Toggling the buzzer on each overflow gives a 2 kHz square wave.",
    steps: ["Turn the sound on and run.", "Change TH0 to 0DH for about 1 kHz.", "Measure the frequency in the panel."],
    questions: ["What is the highest frequency this loop can generate?", "Why no reload instruction inside the loop?"],
    code: `        ORG 0000H
        MOV P2,#00H
        MOV TMOD,#02H   ; timer 0 mode 2
        MOV TH0,#26     ; reload value
        MOV TL0,#26
        SETB TR0
LP:     JNB TF0,$
        CLR TF0
        CPL P2.5        ; buzzer
        SJMP LP`,
    run: 40000,
    check: (k) => { const f = k.buzz.freq(k.t); return res(Math.abs(f - 2003) < 40, `buzzer ${f.toFixed(0)} Hz (expected about 2000 Hz)`); },
  },
  {
    id: "t-count", group: "Timers, interrupts and serial", title: "Timer 0 as an event counter",
    aim: "Count pulses from the pulse generator on T0 (P3.4) and show the count on the LEDs.",
    theory: "With C/T = 1 the timer counts falling edges on T0 instead of machine cycles. The pin is sampled once per machine cycle, so the maximum input frequency is f_osc/24.",
    steps: ["Run with the pulse generator enabled at 1 kHz.", "Watch the LEDs count.", "Lower the generator frequency to 5 Hz and count by eye."],
    questions: ["What is the highest countable frequency at 11.0592 MHz?", "How would you count up to 65535?"],
    code: `        ORG 0000H
        MOV TMOD,#05H   ; timer 0, counter, mode 1
        MOV TH0,#00H
        MOV TL0,#00H
        SETB TR0
LP:     MOV P0,TL0      ; show count
        SJMP LP`,
    setup: (k) => { k.pulse.on = true; k.pulse.hz = 1000; },
    run: 20000,
    check: (k) => { const c = k.cpu.sfr[0x0a]; return res(c >= 18 && c <= 24, `${c} pulses counted in ${(k.t * 1000).toFixed(1)} ms`); },
  },
  {
    id: "t-timer-isr", group: "Timers, interrupts and serial", title: "Timer 0 interrupt: blink in the background",
    aim: "Blink P0.0 every 0.5 s from a Timer 0 interrupt service routine while the main program idles.",
    theory: "With ET0 and EA set, a Timer 0 overflow vectors to 000BH. The ISR reloads the timer (mode 1 does not auto-reload), counts ten overflows and toggles the LED. RETI re-enables the interrupt logic.",
    steps: ["Run and see the LED blink while the CPU is idle.", "Step into the ISR with the Step button.", "Move the toggle into the main loop and compare."],
    questions: ["Why does the vector table need LJMP?", "What happens if the ISR ends with RET instead of RETI?"],
    code: `        ORG 0000H
        LJMP START
        ORG 000BH       ; timer 0 vector
        LJMP T0ISR
        ORG 0030H
START:  MOV SP,#60H
        MOV TMOD,#01H
        MOV TH0,#4CH
        MOV TL0,#00H
        MOV R7,#10
        MOV IE,#82H     ; EA=1, ET0=1
        SETB TR0
        SJMP $          ; main program: idle
T0ISR:  MOV TH0,#4CH    ; reload
        MOV TL0,#00H
        DJNZ R7,EXIT
        MOV R7,#10
        CPL P0.0
EXIT:   RETI`,
    run: 2.6e6,
    check: (k) => { const o = p0log(k); let tg = 0; for (let i = 1; i < o.length; i++) if ((o[i] ^ o[i - 1]) & 1) tg++; return res(tg >= 4, `${tg} toggles in ${k.t.toFixed(2)} s`); },
  },
  {
    id: "t-int0", group: "Timers, interrupts and serial", title: "External interrupt INT0: press counter",
    aim: "Count presses of the INT0 push button in an ISR and show the total on the LEDs.",
    theory: "SETB IT0 makes INT0 edge triggered: a falling edge on P3.2 sets IE0 and vectors to 0003H. The flag is cleared automatically on entry. X0ISR and EA must be set.",
    steps: ["Run and press INT0 in the panel.", "Each press increments the LED count.", "Clear IT0: the interrupt is now level triggered; hold the button."],
    questions: ["How does edge triggering differ from level triggering?", "What is a debounce problem here?"],
    code: `        ORG 0000H
        LJMP START
        ORG 0003H       ; INT0 vector
        LJMP X0ISR
        ORG 0030H
START:  MOV SP,#60H
        MOV 30H,#00H
        MOV P0,#00H
        SETB IT0        ; falling-edge triggered
        MOV IE,#81H     ; EA=1, X0ISR=1
        SJMP $
X0ISR:    INC 30H
        MOV P0,30H
        RETI`,
    run: 500,
    check: (k) => { for (let i = 0; i < 3; i++) { k.button("int0", true); k.run(100); k.button("int0", false); k.run(100); } return res(iram(k, 0x30) === 3 && p0log(k).pop() === 3, `count=${iram(k, 0x30)} after 3 presses`); },
  },
  {
    id: "t-priority", group: "Timers, interrupts and serial", title: "Interrupt priority and nesting",
    aim: "Show that a high-priority interrupt (INT0) can interrupt a low-priority one (Timer 0).",
    theory: "IP bit PX0 = 1 gives INT0 high priority. A high-priority request interrupts a low-priority ISR; RETI restores the priority level. The Timer 0 ISR records 1, requests INT0 in software (SETB IE0) and records 3 - with INT0 high priority the trace reads 1, 2, 3; with equal priorities the order is 1, 3, 2.",
    steps: ["Run and read 50H-52H: 01 02 03.", "Change IP to 00H and run again: 01 03 02.", "Explain the difference."],
    questions: ["Can a low-priority interrupt interrupt a high-priority ISR?", "What does the 8051 do for simultaneous requests at the same level?"],
    code: `        ORG 0000H
        LJMP START
        ORG 0003H       ; INT0
        LJMP X0ISR
        ORG 000BH       ; timer 0
        LJMP T0ISR
        ORG 0030H
START:  MOV SP,#60H
        MOV R0,#50H     ; trace pointer
        MOV TMOD,#01H
        MOV TH0,#0FFH
        MOV TL0,#0F0H   ; overflows after 16 cycles
        SETB IT0
        MOV IP,#01H     ; PX0 = 1: INT0 high priority
        MOV IE,#83H     ; EA, ET0, X0ISR
        SETB TR0
        SJMP $
T0ISR:  CLR TR0
        MOV @R0,#01H
        INC R0
        SETB IE0        ; request INT0 in software
        NOP
        NOP
        MOV @R0,#03H
        INC R0
        RETI
X0ISR:    MOV @R0,#02H
        INC R0
        RETI`,
    run: 1000,
    check: (k) => res([iram(k, 0x50), iram(k, 0x51), iram(k, 0x52)].join() === "1,2,3", `trace ${[iram(k, 0x50), iram(k, 0x51), iram(k, 0x52)].join(" ")}`),
  },
  {
    id: "t-tx", group: "Timers, interrupts and serial", title: "Serial transmit: send HELLO at 9600 baud",
    aim: "Initialise the UART (mode 1, 9600 baud) and send a zero-terminated string to the terminal.",
    theory: "Timer 1 in mode 2 is the baud-rate generator: with SMOD = 0, baud = f_osc / (384 x (256 - TH1)). For 11.0592 MHz and TH1 = FDH this is 9600. SBUF starts the transmission and TI is set when the stop bit has been sent.",
    steps: ["Run and read the terminal.", "Set TH1 to 0FAH for 4800 baud.", "Add a carriage return."],
    questions: ["Why is 11.0592 MHz used?", "What does TI tell the program?"],
    code: `        ORG 0000H
        MOV TMOD,#20H   ; timer 1 mode 2
        MOV TH1,#0FDH   ; 9600 baud
        MOV SCON,#50H   ; mode 1, REN=1
        SETB TR1
        MOV DPTR,#MSG
NEXTC:  CLR A
        MOVC A,@A+DPTR
        JZ  FIN
        MOV SBUF,A
        JNB TI,$        ; wait until sent
        CLR TI
        INC DPTR
        SJMP NEXTC
FIN:    SJMP $
MSG:    DB "HELLO",0DH,0AH,0`,
    run: 20000,
    check: (k) => { const s = k.term.map((c) => String.fromCharCode(c)).join(""); return res(s === "HELLO\r\n", `terminal shows "${s.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`); },
  },
  {
    id: "t-echo", group: "Timers, interrupts and serial", title: "Serial receive: echo (polled)",
    aim: "Wait for a character from the terminal (RI) and send it back.",
    theory: "RI is set when a complete character has been received into SBUF; the program reads SBUF and clears RI. Sending uses TI the same way.",
    steps: ["Run and type in the terminal.", "Convert to upper case with ANL A,#5FH.", "Display the code on the LEDs."],
    questions: ["What happens if RI is not cleared?", "How does polling waste CPU time?"],
    code: `        ORG 0000H
        MOV TMOD,#20H
        MOV TH1,#0FDH
        MOV SCON,#50H
        SETB TR1
LP:     JNB RI,$
        CLR RI
        MOV A,SBUF
        MOV P0,A        ; show code
        MOV SBUF,A      ; echo
        JNB TI,$
        CLR TI
        SJMP LP`,
    run: 1000,
    check: (k) => { k.typeChar(0x4f); k.run(3000); k.typeChar(0x4b); k.run(3000); return res(k.term.join() === [0x4f, 0x4b].join(), `echoed: ${k.term.map((c) => String.fromCharCode(c)).join("")}`); },
  },
  {
    id: "t-serial-isr", group: "Timers, interrupts and serial", title: "Interrupt-driven serial echo",
    aim: "Echo received characters from the serial interrupt (vector 0023H) while the main program is free.",
    theory: "RI and TI share one interrupt. The ISR must test which flag caused it and clear it in software (the hardware does not).",
    steps: ["Run and type characters.", "Add a counter in the main loop.", "Count how often the ISR is entered."],
    questions: ["Why does the ISR see TI after the echo?", "Which flags does the hardware clear?"],
    code: `        ORG 0000H
        LJMP START
        ORG 0023H       ; serial vector
        LJMP SERISR
        ORG 0030H
START:  MOV SP,#60H
        MOV TMOD,#20H
        MOV TH1,#0FDH
        MOV SCON,#50H
        MOV IE,#90H     ; EA=1, ES=1
        SETB TR1
        SJMP $
SERISR: JNB RI,SENT
        CLR RI
        MOV A,SBUF
        MOV SBUF,A      ; echo
        RETI
SENT:   CLR TI
        RETI`,
    run: 1000,
    check: (k) => { k.typeChar(0x51); k.run(4000); return res(k.term.join() === "81", `echoed ${k.term.map((c) => String.fromCharCode(c)).join("")}`); },
  },
  {
    id: "t-freq", group: "Timers, interrupts and serial", title: "Frequency counter",
    aim: "Count T0 pulses for 100 ms (two 50 ms Timer 1 windows) and compute the frequency in Hz into 40H (low) and 41H (high).",
    theory: "Timer 0 counts input edges (counter mode) while Timer 1 measures the gate time. The count over 0.1 s multiplied by 10 is the frequency in Hz.",
    steps: ["Enable the pulse generator at 2 kHz and run.", "Read 40H/41H = 07D0H.", "Change the generator and measure again."],
    questions: ["What limits the maximum frequency?", "How does a longer gate time improve resolution?"],
    code: `        ORG 0000H
        MOV TMOD,#15H   ; T1 timer mode 1, T0 counter mode 1
MEAS:   CLR TR0
        MOV TH0,#00H
        MOV TL0,#00H
        MOV R2,#02H     ; 2 x 50 ms
        SETB TR0
WIN:    MOV TH1,#HIGH(-46080)
        MOV TL1,#LOW(-46080)
        CLR TF1
        SETB TR1
        JNB TF1,$
        CLR TR1
        DJNZ R2,WIN
        CLR TR0
        MOV A,TL0       ; count x 10
        MOV B,#10
        MUL AB
        MOV 40H,A
        MOV R3,B
        MOV A,TH0
        MOV B,#10
        MUL AB
        ADD A,R3
        MOV 41H,A
        MOV P0,40H
        SJMP MEAS`,
    setup: (k) => { k.pulse.on = true; k.pulse.hz = 2000; },
    run: 300000,
    check: (k) => { const f = iram(k, 0x40) | (iram(k, 0x41) << 8); return res(Math.abs(f - 2000) <= 40, `measured ${f} Hz (generator 2000 Hz)`); },
  },
  // ------------------------------------------------------------------ interfacing
  {
    id: "i-chaser", group: "I/O interfacing", title: "LED bouncing chaser",
    aim: "Move a single lit LED left to right and back on the P0 LEDs.",
    theory: "RL A and RR A rotate the pattern, MOV P0,A displays it and a nested-loop delay (about 0.1 s) makes it visible. The 8051 port latches are written, so the LEDs show exactly what was written.",
    steps: ["Run in real time.", "Shorten the delay by changing R7.", "Make two LEDs travel together (03H)."],
    questions: ["What delay does the loop give?", "Why is the first pattern 01H?"],
    code: `        ORG 0000H
START:  MOV A,#01H
        MOV R2,#07H
LEFT:   MOV P0,A
        ACALL DELAY
        RL  A
        DJNZ R2,LEFT
        MOV R2,#07H
RIGHT:  MOV P0,A
        ACALL DELAY
        RR  A
        DJNZ R2,RIGHT
        SJMP START
${DLY("DELAY", 200, 250)}`,
    run: 1.5e6,
    check: (k) => { const o = p0log(k).slice(1, 9); return res(o.slice(0, 7).join() === [1, 2, 4, 8, 16, 32, 64].join(), `P0 sequence ${o.map((v) => hx(v)).join(" ")}`); },
  },
  {
    id: "i-dip", group: "I/O interfacing", title: "DIP switches to LEDs",
    aim: "Read the DIP switches on P1 and show them on the LEDs of P0.",
    theory: "8051 ports are quasi-bidirectional: to use a pin as an input, the latch must hold 1 (MOV P1,#0FFH). A closed switch then pulls the pin to the switch level.",
    steps: ["Run and flip the DIP switches.", "Remove MOV P1,#0FFH after writing 00H to see the pin stuck low.", "Invert the pattern with CPL A."],
    questions: ["Why must a port latch be 1 for input?", "What happens when two outputs drive one line?"],
    code: `        ORG 0000H
        MOV P1,#0FFH    ; make P1 an input port
LP:     MOV A,P1
        MOV P0,A
        SJMP LP`,
    setup: (k) => k.setDip(0xa5),
    run: 200,
    check: (k) => res(p0log(k).pop() === 0xa5, `LEDs=${hx(p0log(k).pop())}H`),
  },
  {
    id: "i-mux", group: "I/O interfacing", title: "Multiplexed 4-digit seven-segment display",
    aim: "Display 1234 by scanning the four digits of the display through 8255 #1 (8000H).",
    theory: "Port A of the 8255 drives the shared segment lines and port B enables one digit at a time. Scanning every 0.5 ms gives each digit 25 % duty; persistence of vision makes all four look lit.",
    steps: ["Run: all digits appear.", "Increase the per-digit delay until flicker appears.", "Add a decimal point (bit 7)."],
    questions: ["Why blank all digits before changing the segments?", "How do you reach 8255 ports with MOVX?"],
    code: `        ORG 0000H
        MOV DPTR,#8003H
        MOV A,#80H      ; all ports output
        MOVX @DPTR,A
SCAN:   MOV R0,#00H     ; digit index
        MOV R1,#01H     ; digit select mask
DIG:    MOV DPTR,#8001H
        CLR A
        MOVX @DPTR,A    ; blank
        MOV DPTR,#TAB
        MOV A,R0
        MOVC A,@A+DPTR
        MOV DPTR,#8000H
        MOVX @DPTR,A    ; segments
        MOV DPTR,#8001H
        MOV A,R1
        MOVX @DPTR,A    ; enable digit
        ACALL DLY
        MOV A,R1
        RL  A
        MOV R1,A
        INC R0
        CJNE R0,#04H,DIG
        SJMP SCAN
DLY:    MOV R7,#200
DLY1:   DJNZ R7,DLY1
        RET
TAB:    DB 06H,5BH,4FH,66H`,
    run: 20000,
    check: (k) => { k.seg.read(k.t); k.run(10000); const s = k.seg.read(k.t); const on = (d) => s[d].map((v) => (v > 0.1 ? 1 : 0)).reduce((a, v, i) => a | (v << i), 0); const g = [0, 1, 2, 3].map(on); return res(g.join() === [6, 0x5b, 0x4f, 0x66].join(), `digit patterns ${g.map((v) => hx(v)).join(" ")}`); },
  },
  {
    id: "i-keypad", group: "I/O interfacing", title: "Matrix keypad to LCD",
    aim: "Scan the 4x4 keypad on 8255 #1 port C and print the hexadecimal key on the LCD.",
    theory: "Rows are driven low one at a time through port C low; the columns are read back on port C high. A key that is down pulls its column low while its row is selected. Key = 4 x row + column.",
    steps: ["Run and click keys in the keypad panel.", "The key appears at the start of the LCD.", "Print a history of keys instead."],
    questions: ["How is a key released detected?", "What if two keys are pressed together?"],
    code: `        ORG 0000H
        MOV SP,#60H
        MOV DPTR,#8003H
        MOV A,#88H      ; C upper = input, C lower = output
        MOVX @DPTR,A
        ACALL LINIT
SCAN:   MOV R0,#00H     ; row
        MOV R1,#0FEH    ; row 0 low
ROW:    MOV DPTR,#8002H
        MOV A,R1
        MOVX @DPTR,A
        MOVX A,@DPTR
        SWAP A
        ANL A,#0FH      ; columns
        CJNE A,#0FH,FOUND
        MOV A,R1
        RL  A
        MOV R1,A
        INC R0
        CJNE R0,#04H,ROW
        SJMP SCAN
FOUND:  MOV R2,#00H     ; column number
COL:    RRC A
        JNC GOT
        INC R2
        SJMP COL
GOT:    MOV A,R0
        RL  A
        RL  A
        ADD A,R2        ; key number 0-15
        MOV R3,A
        CLR C
        SUBB A,#0AH
        MOV A,R3
        JC  DIGIT
        ADD A,#07H
DIGIT:  ADD A,#30H      ; to ASCII
        MOV R3,A
        MOV A,#80H      ; cursor to start of line 1
        ACALL LCMD
        MOV A,R3
        ACALL LDAT
        SJMP SCAN
${LCDLIB}`,
    run: 8000,
    check: (k) => { k.kp.pressed.add(0x0a); k.run(40000); const r = lcdRows(k)[0][0]; k.kp.pressed.clear(); return res(r === "A", `LCD shows "${r}" for key A`); },
  },
  {
    id: "i-lcd", group: "I/O interfacing", title: "16x2 LCD: display a message",
    aim: "Initialise the HD44780 LCD (memory-mapped at C000H) and print two lines using the busy flag.",
    theory: "Commands go to C000H (RS = 0) and data to C001H (RS = 1); C002H reads the status where bit 7 is the busy flag. The initialisation sequence is function set 38H, display on 0CH, entry mode 06H, clear 01H. A command or character written while busy is ignored by the controller.",
    steps: ["Run and read the display.", "Delete the busy-flag test and watch characters disappear.", "Print the second line at 0C0H."],
    questions: ["What does 0C0H mean as a command?", "Why does clear take longer than other commands?"],
    code: `        ORG 0000H
        MOV SP,#60H
        ACALL LINIT
        MOV DPTR,#LINE1
        ACALL LSTR
        MOV A,#0C0H     ; second line
        ACALL LCMD
        MOV DPTR,#LINE2
        ACALL LSTR
        SJMP $
LINE1:  DB "VIN Technologies",0
LINE2:  DB "8051 Trainer Kit",0
${LCDLIB}`,
    run: 40000,
    check: (k) => { const r = lcdRows(k); return res(r[0] === "VIN Technologies" && r[1] === "8051 Trainer Kit" && k.lcd.ignored === 0, `"${r[0]}" / "${r[1]}" (ignored commands: ${k.lcd.ignored})`); },
  },
  {
    id: "i-lcd-cg", group: "I/O interfacing", title: "LCD custom character",
    aim: "Define a heart in CGRAM location 0 and print it between two words.",
    theory: "The first 8 character codes address CGRAM, where each character is 8 rows of 5 bits. Command 40H sets the CGRAM address; the following data writes go to CGRAM, and 80H returns to DDRAM.",
    steps: ["Run and look at the first line.", "Draw your own symbol.", "Animate by rewriting location 0."],
    questions: ["How many custom characters can be stored?", "What happens to the address counter after a CGRAM write?"],
    code: `        ORG 0000H
        MOV SP,#60H
        ACALL LINIT
        MOV A,#40H      ; CGRAM address 0
        ACALL LCMD
        MOV DPTR,#HEART
        MOV R4,#08H
CG1:    CLR A
        MOVC A,@A+DPTR
        PUSH DPH
        PUSH DPL
        ACALL LDAT
        POP DPL
        POP DPH
        INC DPTR
        DJNZ R4,CG1
        MOV A,#80H      ; back to DDRAM
        ACALL LCMD
        MOV DPTR,#TXT1
        ACALL LSTR
        MOV A,#00H      ; custom character 0
        ACALL LDAT
        MOV DPTR,#TXT2
        ACALL LSTR
        SJMP $
TXT1:   DB "I ",0
TXT2:   DB " 8051",0
HEART:  DB 00H,0AH,1FH,1FH,1FH,0EH,04H,00H
${LCDLIB}`,
    run: 40000,
    check: (k) => { const r = lcdRows(k)[0]; return res(r.charCodeAt(2) === 0 && r.startsWith("I ") && r.includes("8051") && k.lcd.cg[2] === 0x1f, `row 1 codes: ${[...r.slice(0, 9)].map((c) => hx(c.charCodeAt(0))).join(" ")}`); },
  },
  {
    id: "i-voltmeter", group: "I/O interfacing", title: "Digital voltmeter: ADC0809 to LCD",
    aim: "Read ADC channel 0 and show the voltage with one decimal on the LCD (for example V=2.5).",
    theory: "The ADC writes a code from 0 to 255 for 0-5 V. Voltage x 10 = code x 50 / 256, which MUL AB (x50) followed by taking the high byte B gives directly. DIV AB by 10 splits it into volts and tenths.",
    steps: ["Run and move the CH0 slider.", "Compare with Vin on the slider.", "Add a second decimal digit."],
    questions: ["What is the quantisation error?", "Why MUL then take B instead of DIV by 256?"],
    code: `        ORG 0000H
        MOV SP,#60H
        ACALL LINIT
MEAS:   MOV DPTR,#0B000H
        MOV A,#00H      ; channel 0, start conversion
        MOVX @DPTR,A
        MOV DPTR,#0B001H
WAITE:  MOVX A,@DPTR    ; EOC in bit 0
        JNB ACC.0,WAITE
        MOV DPTR,#0B000H
        MOVX A,@DPTR    ; result
        MOV B,#50
        MUL AB          ; B = code x 50 / 256 = volts x 10
        MOV A,B
        MOV B,#10
        DIV AB          ; A = volts, B = tenths
        MOV R2,A
        MOV R3,B
        MOV A,#80H
        ACALL LCMD
        MOV A,#'V'
        ACALL LDAT
        MOV A,#'='
        ACALL LDAT
        MOV A,R2
        ADD A,#30H
        ACALL LDAT
        MOV A,#'.'
        ACALL LDAT
        MOV A,R3
        ADD A,#30H
        ACALL LDAT
        SJMP MEAS
${LCDLIB}`,
    setup: (k) => { k.adc.inputs[0] = 3.2; },
    run: 40000,
    check: (k) => { const r = lcdRows(k)[0].trim(); return res(r.startsWith("V=3.1") || r.startsWith("V=3.2"), `LCD shows "${r}" for 3.20 V`); },
  },
  {
    id: "i-adc-led", group: "I/O interfacing", title: "ADC to LED bar and 7-bit bargraph",
    aim: "Show the 8-bit ADC result of channel 1 on the P0 LEDs.",
    theory: "A write to B000H selects the channel and starts the conversion (about 100 us). Bit 0 of B001H is the end-of-conversion flag; reading B000H gives the data.",
    steps: ["Run and drag the CH1 slider.", "Convert to a bar graph by shifting in ones.", "Use channel 2 (temperature)."],
    questions: ["What is the conversion time in machine cycles?", "Could the EOC be wired to INT1?"],
    code: `        ORG 0000H
LP:     MOV DPTR,#0B000H
        MOV A,#01H      ; channel 1
        MOVX @DPTR,A
        MOV DPTR,#0B001H
WT:     MOVX A,@DPTR
        JNB ACC.0,WT
        MOV DPTR,#0B000H
        MOVX A,@DPTR
        MOV P0,A
        SJMP LP`,
    setup: (k) => { k.adc.inputs[1] = 1.25; },
    run: 2000,
    check: (k) => res(p0log(k).pop() === 64, `LEDs=${hx(p0log(k).pop())}H for 1.25 V (expected 40H)`),
  },
  {
    id: "i-stepper", group: "Motors and lamps", title: "Stepper motor: one revolution each way",
    aim: "Rotate the stepper one revolution clockwise then one counter-clockwise using P2.0-P2.3.",
    theory: "Energising two adjacent coils at a time (03H, 06H, 0CH, 09H) steps the rotor 7.5 degrees; 48 steps make a revolution. The delay between steps sets the speed; steps are missed above about 500 steps/s.",
    steps: ["Run and watch the rotor.", "Shorten the delay below 2 ms.", "Use half-stepping."],
    questions: ["How many steps for 180 degrees?", "How do you stop the motor but keep holding torque?"],
    code: `        ORG 0000H
        MOV R4,#12      ; 12 x 4 = 48 steps
CW:     MOV R2,#00H
CW1:    MOV A,R2
        MOV DPTR,#SEQ
        MOVC A,@A+DPTR
        MOV P2,A
        ACALL DELAY
        INC R2
        CJNE R2,#04H,CW1
        DJNZ R4,CW
        MOV P2,#00H
        MOV R4,#12
CCW:    MOV R2,#03H
CCW1:   MOV A,R2
        MOV DPTR,#SEQ
        MOVC A,@A+DPTR
        MOV P2,A
        ACALL DELAY
        DEC R2
        CJNE R2,#0FFH,CCW1
        DJNZ R4,CCW
        MOV P2,#00H
        SJMP $
${DLY("DELAY", 5, 240)}
SEQ:    DB 03H,06H,0CH,09H`,
    run: 300000,
    check: (k) => res(Math.abs(k.stepper.angle) < 8 && k.stepper.missed === 0 && k.stepper.steps >= 90, `net angle ${k.stepper.angle.toFixed(1)} deg, steps ${k.stepper.steps}, missed ${k.stepper.missed}`),
  },
  {
    id: "i-motor", group: "Motors and lamps", title: "DC motor: PWM speed and direction",
    aim: "Control motor speed with software PWM (duty in 30H) and direction with P2.7 (31H bit 0).",
    theory: "P2.6 enables the motor driver and P2.7 sets the direction. Switching the enable for N of every 255 time units gives an average voltage of N/255 x supply, so speed follows the duty cycle.",
    steps: ["Run with duty 40H (25 %).", "Set 30H to C0H and run again (75 %).", "Set 31H to 1 to reverse."],
    questions: ["Why is PWM efficient?", "How could Timer 0 generate the PWM instead?"],
    code: `        ORG 0000H
        MOV A,31H
        MOV C,ACC.0
        MOV P2.7,C      ; direction
        MOV A,30H
        MOV R2,A        ; duty
LP:     MOV A,R2
        JZ  OFFP
        SETB P2.6
        MOV R3,2        ; R3 = R2
ONL:    DJNZ R3,ONL
OFFP:   CLR P2.6
        MOV A,#255
        CLR C
        SUBB A,R2
        JZ  LP
        MOV R3,A
OFFL:   DJNZ R3,OFFL
        SJMP LP`,
    setup: (k) => setI(k, 0x30, [0x40, 0x00]),
    run: 40000,
    check: (k) => { k.motorEn.read(k.t); k.run(30000); const d = k.motorEn.read(k.t)[0]; return res(Math.abs(d - 0.25) < 0.08, `measured duty ${(d * 100).toFixed(0)} %`); },
  },
  {
    id: "i-relay", group: "Motors and lamps", title: "Relay toggled by INT1",
    aim: "Toggle the relay on P2.4 every time the INT1 button is pressed.",
    theory: "INT1 (P3.3) is configured falling-edge triggered with SETB IT1; its ISR at 0013H complements P2.4. The relay driver needs the transistor/ULN2003 stage, and the contact click is audible.",
    steps: ["Run and press INT1.", "Hear the relay click.", "Add a freewheel diode discussion."],
    questions: ["Why is a flyback diode needed across a relay coil?", "What is switch bounce and how can it be removed in software?"],
    code: `        ORG 0000H
        LJMP START
        ORG 0013H       ; INT1 vector
        LJMP X1ISR
        ORG 0030H
START:  MOV SP,#60H
        MOV P2,#00H
        SETB IT1
        MOV IE,#84H     ; EA, X1ISR
        SJMP $
X1ISR:    CPL P2.4
        RETI`,
    run: 300,
    check: (k) => { k.button("int1", true); k.run(100); k.button("int1", false); k.run(100); const a = k.relay; k.button("int1", true); k.run(100); k.button("int1", false); k.run(100); return res(a === 1 && k.relay === 0, `relay after press 1 = ${a}, after press 2 = ${k.relay}`); },
  },
  {
    id: "i-traffic", group: "Motors and lamps", title: "Traffic-light controller (8255 #2)",
    aim: "Run a two-road junction on 8255 #2 port A (9000H): bits 0-2 = R1 Y1 G1, bits 3-5 = R2 Y2 G2.",
    theory: "Each phase is a fixed lamp pattern held for a time. Using a timer-based delay (here 1 s green and 0.3 s yellow) keeps the program short. Never display G1 and G2 together.",
    steps: ["Run and watch the junction picture.", "Add a pedestrian request on INT0.", "Add an all-red phase."],
    questions: ["Which patterns are unsafe?", "How would the sequence be driven from a Timer 0 ISR?"],
    code: `        ORG 0000H
        MOV DPTR,#9003H
        MOV A,#80H
        MOVX @DPTR,A    ; 8255 #2 outputs
CYC:    MOV A,#0CH      ; G1 + R2
        ACALL SHOW
        MOV R4,#20
        ACALL WAITN
        MOV A,#0AH      ; Y1 + R2
        ACALL SHOW
        MOV R4,#6
        ACALL WAITN
        MOV A,#21H      ; R1 + G2
        ACALL SHOW
        MOV R4,#20
        ACALL WAITN
        MOV A,#11H      ; R1 + Y2
        ACALL SHOW
        MOV R4,#6
        ACALL WAITN
        SJMP CYC
SHOW:   MOV DPTR,#9000H
        MOVX @DPTR,A
        RET
WAITN:  MOV TMOD,#01H   ; R4 x 50 ms
W1:     MOV TH0,#4CH
        MOV TL0,#00H
        SETB TR0
        JNB TF0,$
        CLR TR0
        CLR TF0
        DJNZ R4,W1
        RET`,
    run: 3.2e6,
    check: (k) => { const o = k.xLog.filter((e) => e[0] === 0x9000).map((e) => e[1]); return res(o.slice(0, 4).join() === [0x0c, 0x0a, 0x21, 0x11].join(), `lamp patterns: ${o.slice(0, 5).map((v) => hx(v)).join(" ")}`); },
  },
  {
    id: "i-sine", group: "DAC and ADC", title: "DAC: sine, triangle and sawtooth waves",
    aim: "Output a sine wave from a 32-entry table on the DAC at A000H.",
    theory: "The DAC converts the code to Vref x code/256. Stepping through a stored sine table gives a staircase approximation of a sine wave; the output frequency is the table length times the sample period.",
    steps: ["Run and open the scope.", "Measure the frequency (about 2.9 kHz).", "Replace the table with a triangle."],
    questions: ["How can the frequency be lowered?", "What sets the number of distinct output levels?"],
    code: `        ORG 0000H
AGAIN:  MOV R1,#00H
SMP:    MOV DPTR,#TAB
        MOV A,R1
        MOVC A,@A+DPTR
        MOV DPTR,#0A000H
        MOVX @DPTR,A
        INC R1
        CJNE R1,#32,SMP
        SJMP AGAIN
TAB:    DB ${dbList(sine32.slice(0, 16))}
        DB ${dbList(sine32.slice(16))}`,
    run: 20000,
    check: (k) => { const v = k.dac.ev.filter((_, i) => i % 2 === 1).slice(0, 32); return res(v.join() === sine32.join(), `first 32 DAC samples ${v.join() === sine32.join() ? "match" : "differ from"} the table`); },
  },
  {
    id: "i-saw", group: "DAC and ADC", title: "DAC: sawtooth and triangle",
    aim: "Output three sawtooth cycles then three triangle cycles on the DAC.",
    theory: "Incrementing A in a loop and writing it out gives a ramp that wraps at 255 (sawtooth). Counting up then down gives a triangle. Both are exact because the DAC is 8 bits wide.",
    steps: ["Run and watch the scope.", "Add a delay for lower frequency.", "Generate a staircase."],
    questions: ["What is the sawtooth frequency?", "How is the amplitude changed?"],
    code: `        ORG 0000H
        MOV DPTR,#0A000H
START:  MOV R2,#03H
SAWC:   CLR A
SAW:    MOVX @DPTR,A
        INC A
        JNZ SAW
        DJNZ R2,SAWC
        MOV R2,#03H
TRIC:   CLR A
UP:     MOVX @DPTR,A
        INC A
        JNZ UP
        MOV A,#0FFH
DN:     MOVX @DPTR,A
        DEC A
        JNZ DN
        DJNZ R2,TRIC
        SJMP START`,
    run: 20000,
    check: (k) => { const v = k.dac.ev.filter((_, i) => i % 2 === 1); return res(v.length > 500 && Math.max(...v) === 255 && Math.min(...v) === 0, `${v.length} samples, range ${Math.min(...v)}-${Math.max(...v)}`); },
  },
];
