// 8085 experiments. Each has source, preset data/switches, and a check() that the test-suite and the "Check result" button run.
const mem = (k, a) => k.cpu.mem[a];
const w16 = (k, a) => k.cpu.mem[a] | (k.cpu.mem[a + 1] << 8);
const set = (k, a, bytes) => { bytes.forEach((b, i) => (k.cpu.mem[a + i] = b)); };
const hx = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, "0");
const res = (ok, msg) => ({ ok, msg });
const sine32 = Array.from({ length: 32 }, (_, i) => Math.round(127.5 + 127 * Math.sin((2 * Math.PI * i) / 32)));
const h0 = (v, n = 2) => "0" + hx(v, n) + "H";
const dbList = (a) => a.map((v) => h0(v)).join(",");
const lastOut = (k, port) => { for (let i = k.ioLog.length - 1; i >= 0; i--) if (k.ioLog[i][0] === port) return k.ioLog[i][1]; return null; };
const outs = (k, port) => k.ioLog.filter((e) => e[0] === port).map((e) => e[1]);
const DELAY = (name, count) => `${name}:  PUSH PSW
        PUSH B
        LXI B,${h0(count, 4)}
${name}1: DCX B
        MOV A,B
        ORA C
        JNZ ${name}1
        POP B
        POP PSW
        RET`;

export const EX8085 = [
  // ------------------------------------------------------------------ programming
  {
    id: "a-add8", group: "Arithmetic programs", title: "Add two 8-bit numbers",
    aim: "Add the bytes at 3000H and 3001H; store the sum at 3002H and the carry at 3003H.",
    theory: "ADD r adds a register to the accumulator and updates S, Z, AC, P and CY. CY is set when the sum exceeds 255. ACI 00H after clearing A adds the carry into A so it can be stored as a byte.",
    steps: ["Enter the numbers at 3000H/3001H (preloaded: F5H and 0CH).", "Assemble and Run (or press Step to watch A, B and the flags change).", "Read 3002H (sum) and 3003H (carry) in the memory panel."],
    questions: ["Which flags are set after F5H + 0CH?", "How would you extend this to add three numbers?"],
    code: `        ORG 2000H
        LDA 3000H       ; first number
        MOV B,A
        LDA 3001H       ; second number
        ADD B           ; A = A + B, CY = carry out
        STA 3002H       ; sum
        MVI A,00H
        ACI 00H         ; A = carry
        STA 3003H
        HLT`,
    setup: (k) => set(k, 0x3000, [0xf5, 0x0c]),
    check: (k) => res(mem(k, 0x3002) === 0x01 && mem(k, 0x3003) === 1, `sum=${hx(mem(k, 0x3002))}H carry=${mem(k, 0x3003)} (expected 01H, 1)`),
  },
  {
    id: "a-add16", group: "Arithmetic programs", title: "16-bit addition with DAD",
    aim: "Add the 16-bit numbers at 3000H-3001H and 3002H-3003H; store the 17-bit result at 3004H-3006H.",
    theory: "The 8085 stores 16-bit data low byte first. LHLD loads HL from two memory bytes, DAD D adds DE to HL and sets only the carry flag. RAL moves that carry into bit 0 of A.",
    steps: ["Numbers F234H and 1B78H are preloaded.", "Run and read 3004H-3006H.", "Change the inputs so that no carry occurs."],
    questions: ["Why does DAD not affect the zero flag?", "Why is the low byte stored first?"],
    code: `        ORG 2000H
        LHLD 3000H      ; HL = first number
        XCHG            ; DE = first number
        LHLD 3002H      ; HL = second number
        DAD D           ; HL = HL + DE, CY = carry
        SHLD 3004H      ; low byte then high byte
        MVI A,00H
        RAL             ; A = carry
        STA 3006H
        HLT`,
    setup: (k) => set(k, 0x3000, [0x34, 0xf2, 0x78, 0x1b]),
    check: (k) => res(w16(k, 0x3004) === 0x0dac && mem(k, 0x3006) === 1, `result=${mem(k, 0x3006)}:${hx(w16(k, 0x3004), 4)}H (expected 1:0DACH)`),
  },
  {
    id: "a-sub8", group: "Arithmetic programs", title: "8-bit subtraction and borrow",
    aim: "Subtract [3001H] from [3000H], store the difference at 3002H and the borrow flag at 3003H.",
    theory: "SUB performs A - r using 2's complement addition. CY = 1 means a borrow occurred (the result is negative and held in 2's complement form).",
    steps: ["Run with 05H - 0AH.", "Observe the result FBH = -5 and CY = 1.", "Swap the operands and compare."],
    questions: ["Convert FBH back to a signed number.", "Which flag would you test for signed overflow?"],
    code: `        ORG 2000H
        LDA 3001H
        MOV B,A         ; B = subtrahend
        LDA 3000H
        SUB B           ; A = A - B
        STA 3002H
        MVI A,00H
        RAL             ; A = borrow (CY)
        STA 3003H
        HLT`,
    setup: (k) => set(k, 0x3000, [0x05, 0x0a]),
    check: (k) => res(mem(k, 0x3002) === 0xfb && mem(k, 0x3003) === 1, `diff=${hx(mem(k, 0x3002))}H borrow=${mem(k, 0x3003)} (expected FBH, 1)`),
  },
  {
    id: "a-mul", group: "Arithmetic programs", title: "8-bit multiplication by repeated addition",
    aim: "Multiply [3000H] by [3001H]; the 16-bit product goes to 3002H-3003H.",
    theory: "The 8085 has no multiply instruction. Adding the multiplicand to a 16-bit accumulator (HL) as many times as the multiplier gives the product. DAD D does the 16-bit add.",
    steps: ["25 x 13 is preloaded (19H x 0DH = 0145H).", "Single-step a few iterations and watch HL grow.", "Try a multiplier of 0."],
    questions: ["How many instructions execute for multiplier 0DH?", "How can shifting make this faster?"],
    code: `        ORG 2000H
        LDA 3000H
        MOV E,A
        MVI D,00H       ; DE = multiplicand
        LDA 3001H
        MOV B,A         ; B = multiplier (loop count)
        LXI H,0000H     ; HL = product
        ORA A
        JZ  DONE        ; multiplier 0 -> product 0
LOOP:   DAD D
        DCR B
        JNZ LOOP
DONE:   SHLD 3002H
        HLT`,
    setup: (k) => set(k, 0x3000, [25, 13]),
    check: (k) => res(w16(k, 0x3002) === 325, `product=${w16(k, 0x3002)} (expected 325)`),
  },
  {
    id: "a-div", group: "Arithmetic programs", title: "Division by repeated subtraction",
    aim: "Divide [3000H] by [3001H]; quotient to 3002H, remainder to 3003H.",
    theory: "Subtract the divisor from the dividend until the result would go negative (CY set by CMP). The count of subtractions is the quotient and what is left is the remainder. A zero divisor must be rejected first.",
    steps: ["100 / 7 is preloaded.", "Run; expect quotient 0EH and remainder 02H.", "Set the divisor to 0 and see the error marker FFH."],
    questions: ["What does CMP B do to the accumulator?", "Why is a divide-by-zero guard needed?"],
    code: `        ORG 2000H
        LDA 3001H
        MOV B,A         ; B = divisor
        ORA A
        JZ  ERR
        LDA 3000H       ; A = dividend
        MVI C,00H       ; C = quotient
LOOP:   CMP B           ; dividend < divisor ?
        JC  DONE
        SUB B
        INR C
        JMP LOOP
DONE:   STA 3003H       ; remainder
        MOV A,C
        STA 3002H       ; quotient
        HLT
ERR:    MVI A,0FFH
        STA 3002H
        HLT`,
    setup: (k) => set(k, 0x3000, [100, 7]),
    check: (k) => res(mem(k, 0x3002) === 14 && mem(k, 0x3003) === 2, `Q=${mem(k, 0x3002)} R=${mem(k, 0x3003)} (expected 14, 2)`),
  },
  {
    id: "a-bcd", group: "Arithmetic programs", title: "BCD addition with DAA",
    aim: "Add two packed-BCD bytes: sum at 3002H, carry at 3003H.",
    theory: "After a binary ADD of BCD digits the result can hold invalid digits (A-F). DAA adds 06H to a bad low nibble and 60H to a bad high nibble, using AC and CY, to restore valid BCD.",
    steps: ["59 + 47 is preloaded.", "Step through ADD: A = A0H. Step DAA: A = 06H, CY = 1.", "Result is BCD 106."],
    questions: ["Why can't DAA be used after SUB directly?", "What does AC record?"],
    code: `        ORG 2000H
        LDA 3000H
        MOV B,A
        LDA 3001H
        ADD B
        DAA             ; decimal adjust
        STA 3002H
        MVI A,00H
        RAL
        STA 3003H
        HLT`,
    setup: (k) => set(k, 0x3000, [0x59, 0x47]),
    check: (k) => res(mem(k, 0x3002) === 0x06 && mem(k, 0x3003) === 1, `BCD sum=${mem(k, 0x3003)}${hx(mem(k, 0x3002))} (expected 106)`),
  },
  {
    id: "b-largest", group: "Data handling", title: "Largest number in an array",
    aim: "The count is at 3000H and the array starts at 3001H. Store the largest value at 3020H.",
    theory: "Keep the current maximum in A and compare with every element using CMP M. If A >= M (no carry) keep it, otherwise load the new element.",
    steps: ["Six numbers are preloaded.", "Run and read 3020H.", "Change the list and retest."],
    questions: ["How would you find the smallest instead?", "What happens for a count of 1?"],
    code: `        ORG 2000H
        LXI H,3000H
        MOV C,M         ; C = count
        INX H
        MOV A,M         ; assume first is largest
        DCR C
LOOP:   INX H
        CMP M
        JNC SKIP        ; A >= M
        MOV A,M
SKIP:   DCR C
        JNZ LOOP
        STA 3020H
        HLT`,
    setup: (k) => set(k, 0x3000, [6, 0x12, 0xa5, 0x3c, 0xf0, 0x07, 0x80]),
    check: (k) => res(mem(k, 0x3020) === 0xf0, `largest=${hx(mem(k, 0x3020))}H (expected F0H)`),
  },
  {
    id: "b-sort", group: "Data handling", title: "Sort an array in ascending order (bubble sort)",
    aim: "Sort the n bytes starting at 3001H (count in 3000H) in place.",
    theory: "Bubble sort compares neighbours and swaps them when out of order. After each pass the largest element has moved to the end, so n-1 passes suffice. HL walks the array; B holds the swap temporary.",
    steps: ["Preloaded list: 25 12 09 FF 03 40.", "Run and read 3001H-3006H.", "Step the first pass to watch FFH bubble to the end."],
    questions: ["How many comparisons does the first pass make?", "How would you sort in descending order?"],
    code: `        ORG 2000H
        LDA 3000H
        DCR A
        JZ  DONE        ; 0 or 1 element: nothing to do
        MOV D,A         ; D = number of passes
OUTER:  LXI H,3001H
        MOV C,D
INNER:  MOV A,M
        INX H
        CMP M
        JC  NOSWAP      ; already ordered
        JZ  NOSWAP
        MOV B,M         ; swap M-1 and M
        MOV M,A
        DCX H
        MOV M,B
        INX H
NOSWAP: DCR C
        JNZ INNER
        DCR D
        JNZ OUTER
DONE:   HLT`,
    setup: (k) => set(k, 0x3000, [6, 0x25, 0x12, 0x09, 0xff, 0x03, 0x40]),
    check: (k) => {
      const got = Array.from({ length: 6 }, (_, i) => mem(k, 0x3001 + i));
      return res(got.join() === [0x03, 0x09, 0x12, 0x25, 0x40, 0xff].join(), `array=${got.map((v) => hx(v)).join(" ")}`);
    },
  },
  {
    id: "b-move", group: "Data handling", title: "Block transfer",
    aim: "Copy 8 bytes from 3000H to 3100H.",
    theory: "HL is the source pointer (used with MOV A,M), DE the destination pointer (used with STAX D). INX moves both pointers and DCR/JNZ counts the bytes.",
    steps: ["Eight bytes are preloaded at 3000H.", "Run, then view memory page 3100H.", "Make the transfer overlap and see what goes wrong."],
    questions: ["Why does an overlapping upward copy corrupt data?", "Which instruction pair could replace the loop on an 8080 with a block-move instruction?"],
    code: `        ORG 2000H
        LXI H,3000H     ; source
        LXI D,3100H     ; destination
        MVI C,08H
LOOP:   MOV A,M
        STAX D
        INX H
        INX D
        DCR C
        JNZ LOOP
        HLT`,
    setup: (k) => set(k, 0x3000, [1, 2, 3, 4, 5, 6, 7, 8].map((v) => v * 0x11)),
    check: (k) => res([0, 1, 2, 3, 4, 5, 6, 7].every((i) => mem(k, 0x3100 + i) === (i + 1) * 0x11), "destination equals source"),
  },
  {
    id: "b-ones", group: "Data handling", title: "Count the 1s in a byte (parity)",
    aim: "Count the number of 1 bits in [3000H]; store the count at 3001H and the parity (1 = odd) at 3002H.",
    theory: "RAR rotates A right through the carry flag, so each pass tests one bit with JNC. Eight rotations visit all bits.",
    steps: ["B7H = 10110111B is preloaded.", "Run: count 6, parity 0.", "Compare with the P flag after an ORA A."],
    questions: ["How does this relate to the 8085 parity flag?", "How many T-states does the loop need?"],
    code: `        ORG 2000H
        LDA 3000H
        MVI B,00H       ; count
        MVI C,08H       ; bits
LOOP:   RAR
        JNC SKIP
        INR B
SKIP:   DCR C
        JNZ LOOP
        MOV A,B
        STA 3001H
        ANI 01H
        STA 3002H
        HLT`,
    setup: (k) => set(k, 0x3000, [0xb7]),
    check: (k) => res(mem(k, 0x3001) === 6 && mem(k, 0x3002) === 0, `ones=${mem(k, 0x3001)} parity=${mem(k, 0x3002)}`),
  },
  {
    id: "b-ascii", group: "Data handling", title: "Hex byte to ASCII characters (subroutine)",
    aim: "Convert the byte at 3000H into two ASCII characters at 3001H and 3002H.",
    theory: "A nibble 0-9 becomes ASCII by adding 30H; A-F needs an extra 07H. The conversion is a subroutine (CALL/RET) which pushes the return address on the stack, so SP must be initialised.",
    steps: ["5CH is preloaded.", "Run: 3001H = '5' (35H), 3002H = 'C' (43H).", "Step into CALL and watch SP and the stack."],
    questions: ["Where does CALL store the return address?", "What would happen without LXI SP?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        LDA 3000H
        MOV B,A
        RRC
        RRC
        RRC
        RRC
        ANI 0FH         ; high nibble
        CALL ASC
        STA 3001H
        MOV A,B
        ANI 0FH         ; low nibble
        CALL ASC
        STA 3002H
        HLT
ASC:    CPI 0AH
        JC  DIGIT
        ADI 07H
DIGIT:  ADI 30H
        RET`,
    setup: (k) => set(k, 0x3000, [0x5c]),
    check: (k) => res(mem(k, 0x3001) === 0x35 && mem(k, 0x3002) === 0x43, `chars=${hx(mem(k, 0x3001))} ${hx(mem(k, 0x3002))}`),
  },
  {
    id: "b-lut", group: "Data handling", title: "Squares from a look-up table",
    aim: "Look up the square of the digit in [3000H] (0-9) and store it at 3001H.",
    theory: "A table in memory is indexed with HL = table base + index (DAD D). Tables replace calculations with a single memory read.",
    steps: ["Digit 7 is preloaded: 49 = 31H.", "Try other digits.", "Extend the table to 15."],
    questions: ["What limits the table size?", "When is a table better than computing?"],
    code: `        ORG 2000H
        LDA 3000H
        MOV E,A
        MVI D,00H
        LXI H,TAB
        DAD D           ; HL = TAB + index
        MOV A,M
        STA 3001H
        HLT
TAB:    DB 0,1,4,9,16,25,36,49,64,81`,
    setup: (k) => set(k, 0x3000, [7]),
    check: (k) => res(mem(k, 0x3001) === 49, `square=${mem(k, 0x3001)} (expected 49)`),
  },
  {
    id: "b-stack", group: "Data handling", title: "Reverse a string with PUSH and POP",
    aim: "Reverse the 8 bytes at 3000H into 3010H using the stack.",
    theory: "The stack is last-in first-out. Pushing eight bytes and popping them back returns them in reverse order. PUSH PSW saves A (high byte) and the flags.",
    steps: ["'ABCDEFGH' is preloaded.", "Run and view 3010H.", "Watch SP move down in 2-byte steps."],
    questions: ["Which direction does SP move on PUSH?", "How many bytes of stack are used?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        LXI H,3000H
        MVI C,08H
PSH:    MOV A,M
        PUSH PSW
        INX H
        DCR C
        JNZ PSH
        LXI H,3010H
        MVI C,08H
POPL:   POP PSW
        MOV M,A
        INX H
        DCR C
        JNZ POPL
        HLT`,
    setup: (k) => set(k, 0x3000, [..."ABCDEFGH"].map((c) => c.charCodeAt(0))),
    check: (k) => res(Array.from({ length: 8 }, (_, i) => String.fromCharCode(mem(k, 0x3010 + i))).join("") === "HGFEDCBA", "3010H = HGFEDCBA"),
  },
  {
    id: "b-delay", group: "Data handling", title: "Software delay and timing (SOD blinker)",
    aim: "Create a delay with a nested loop, calculate its length in T-states and blink the SOD pin.",
    theory: "Each instruction takes a known number of T-states (DCX 6, MOV 4, ORA 4, JNZ 10 = 24 T per pass). At 3 MHz one T-state is 0.333 us, so the 16-bit loop below runs 65535 x 24 x 0.333 us = 0.52 s. SIM with bit 6 set loads SOD from bit 7.",
    steps: ["Run in real time (speed 1x) and watch the SOD indicator.", "Check the T-state counter against the calculation.", "Change the count to get a 1 s delay."],
    questions: ["Compute the delay for BC = 4000H.", "Why is a software delay inaccurate if interrupts occur?"],
    code: `        ORG 2000H
        LXI SP,27FFH
BLINK:  MVI A,0C0H      ; SDE=1 (bit 6), SOD=1
        SIM
        CALL DELAY
        MVI A,40H       ; SOD=0
        SIM
        CALL DELAY
        JMP BLINK
${DELAY("DELAY", 0xffff)}`,
    run: 6e6,
    check: (k) => res(k.cpu.tstates > 5e6 && k.sodToggles >= 3, `SOD toggled ${k.sodToggles} times in ${k.t.toFixed(2)} s (${k.cpu.tstates} T-states)`),
  },
  // ------------------------------------------------------------------ I/O: 8255, LEDs, switches
  {
    id: "c-led", group: "Parallel I/O (8255)", title: "Walking LED on port A",
    aim: "Initialise 8255 #1 (ports 00H-03H) with port A as output and walk a single lit LED across the 8-LED bar.",
    theory: "The control word 80H selects mode 0 with all ports as outputs. Writing a byte to port A (OUT 00H) drives the LEDs. RLC rotates the pattern left each step, and a delay makes the motion visible.",
    steps: ["Run at 1x real-time speed.", "Change the delay constant to speed it up.", "Use RRC to walk the other way."],
    questions: ["What happens to the LEDs if the control word is never written?", "Which control word makes port A input and port B output?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        MVI A,80H       ; mode 0, A/B/C all outputs
        OUT 03H
        MVI A,01H
LOOP:   OUT 00H         ; port A -> LEDs
        CALL DELAY
        RLC
        JMP LOOP
${DELAY("DELAY", 0x5000)}`,
    run: 2e6,
    check: (k) => { const o = outs(k, 0); return res(o.length >= 3 && o.slice(0, 4).join() === [1, 2, 4, 8].join(), `port A sequence: ${o.slice(0, 6).map((v) => hx(v)).join(" ")}`); },
  },
  {
    id: "c-dip", group: "Parallel I/O (8255)", title: "DIP switches to LEDs (input port)",
    aim: "Read the 8 DIP switches on port B and mirror them on the LEDs of port A.",
    theory: "Control word 82H makes port B an input (D1 = 1) and port A an output. IN 01H reads the switch levels and OUT 00H drives the LEDs, so the board behaves like a wire.",
    steps: ["Run, then toggle the DIP switches in the panel.", "Change 82H to 80H: the inputs disappear.", "Invert the data with CMA."],
    questions: ["Why is polling used instead of interrupts here?", "What does an unconfigured 8255 do after reset?"],
    code: `        ORG 2000H
        MVI A,82H       ; A out, B in
        OUT 03H
LOOP:   IN  01H         ; read switches
        OUT 00H         ; show on LEDs
        JMP LOOP`,
    setup: (k) => { k.dip = 0x5a; },
    run: 2e4,
    check: (k) => res(lastOut(k, 0) === 0x5a, `LEDs=${hx(lastOut(k, 0) ?? 0)}H, switches=5AH`),
  },
  {
    id: "c-7seg", group: "Parallel I/O (8255)", title: "Seven-segment counter 0-F",
    aim: "Show the hex digits 0 to F one after another on digit 0 of the display.",
    theory: "8255 #2 port A drives segments a-g (bit 0 = a) and port B selects the digit. A code table (3FH for '0', 06H for '1', ...) converts a number into segment bits.",
    steps: ["Run and watch digit 0.", "Replace the table to display letters.", "Select a different digit with port B."],
    questions: ["What is the code for '8'?", "How do common-anode displays differ?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        MVI A,80H
        OUT 13H         ; 8255 #2 all outputs
        MVI A,01H
        OUT 11H         ; select digit 0
        MVI E,00H       ; E = digit value 0..F
NEXT:   MVI D,00H
        LXI H,TAB
        DAD D           ; HL = TAB + E
        MOV A,M
        OUT 10H         ; segments
        CALL DELAY
        INR E
        MOV A,E
        ANI 0FH
        MOV E,A
        JMP NEXT
${DELAY("DELAY", 0x4000)}
TAB:    DB 3FH,06H,5BH,4FH,66H,6DH,7DH,07H,7FH,6FH,77H,7CH,39H,5EH,79H,71H`,
    run: 3e6,
    check: (k) => { const o = outs(k, 0x10); return res(o.slice(0, 5).join() === [0x3f, 0x06, 0x5b, 0x4f, 0x66].join(), `segment codes: ${o.slice(0, 6).map((v) => hx(v)).join(" ")}`); },
  },
  {
    id: "c-mux", group: "Parallel I/O (8255)", title: "Multiplexed 4-digit display",
    aim: "Display 1234 on four digits by scanning them faster than the eye can follow.",
    theory: "Segments of all digits are wired together, so only one digit can be lit at a time. Selecting each digit for about 1 ms in turn gives each a 25 % duty cycle, which persistence of vision turns into a steady picture.",
    steps: ["Run: all four digits appear lit.", "Lengthen the per-digit delay until flicker appears.", "Add a fifth digit."],
    questions: ["What refresh rate is needed to avoid flicker?", "Why must the digit be blanked before the segments change?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        MVI A,80H
        OUT 13H
SCAN:   LXI H,MSG
        MVI D,01H       ; digit select mask
        MVI C,04H
DIG:    MVI A,00H
        OUT 11H         ; blank while changing segments
        MOV A,M
        OUT 10H
        MOV A,D
        OUT 11H
        CALL DLY1MS
        INX H
        MOV A,D
        RLC
        MOV D,A
        DCR C
        JNZ DIG
        JMP SCAN
DLY1MS: PUSH B
        LXI B,0080H
D1:     DCX B
        MOV A,B
        ORA C
        JNZ D1
        POP B
        RET
MSG:    DB 06H,5BH,4FH,66H`,
    run: 3e5,
    check: (k) => { k.seg.read(k.t); k.run(30000); const s = k.seg.read(k.t); const on = (d) => s[d].map((v) => (v > 0.1 ? 1 : 0)).reduce((a, v, i) => a | (v << i), 0); const got = [on(0), on(1), on(2), on(3)]; return res(got.join() === [0x06, 0x5b, 0x4f, 0x66].join(), `digit patterns: ${got.map((v) => hx(v)).join(" ")}`); },
  },
  {
    id: "c-keypad", group: "Parallel I/O (8255)", title: "4x4 matrix keypad scanner",
    aim: "Scan the 4x4 keypad on 8255 #2 port C and show the pressed key on the seven-segment display.",
    theory: "Port C low nibble drives the four rows (one row low at a time) and the upper nibble reads the four columns, which have pull-ups. A pressed key connects its row to its column, so the column reads 0 when its row is selected. Key number = 4 x row + column.",
    steps: ["Run, then click keys on the keypad in the panel.", "Observe the key number on digit 0.", "Hold two keys and discuss ghosting."],
    questions: ["Why is a pull-up needed on each column?", "How many I/O lines does a 4x4 keypad save compared with 16 switches?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        MVI A,88H       ; A,B out, C upper in, C lower out
        OUT 13H
        MVI A,01H
        OUT 11H         ; digit 0 on
SCAN:   MVI B,00H       ; row number
        MVI C,0FEH      ; row 0 low
ROW:    MOV A,C
        OUT 12H
        IN  12H
        RRC
        RRC
        RRC
        RRC
        ANI 0FH         ; columns in low nibble
        CPI 0FH
        JNZ FOUND
        MOV A,C
        RLC             ; next row low
        MOV C,A
        INR B
        MOV A,B
        CPI 04H
        JNZ ROW
        JMP SCAN
FOUND:  MVI D,00H       ; D = column number
COL:    RRC
        JNC GOT
        INR D
        JMP COL
GOT:    MOV A,B
        RLC
        RLC
        ADD D           ; A = key number
        MOV E,A
        MVI D,00H
        LXI H,TAB
        DAD D
        MOV A,M
        OUT 10H
        JMP SCAN
TAB:    DB 3FH,06H,5BH,4FH,66H,6DH,7DH,07H,7FH,6FH,77H,7CH,39H,5EH,79H,71H`,
    run: 2e5,
    check: (k) => { k.kp.pressed.add(0x0a); k.run(40000); k.seg.read(k.t); k.run(20000); const s = k.seg.read(k.t)[0].map((v) => (v > 0.5 ? 1 : 0)).reduce((a, v, i) => a | (v << i), 0); k.kp.pressed.clear(); return res(s === 0x77, `display for key A: ${hx(s)}H (expected 77H)`); },
  },
  {
    id: "c-step", group: "Motors and lamps", title: "Stepper motor: one revolution each way",
    aim: "Rotate the stepper one full turn clockwise, pause, then one turn counter-clockwise.",
    theory: "A unipolar stepper has four coils driven through a ULN2003. Energising two adjacent coils at a time (03H, 06H, 0CH, 09H) moves the rotor one step of 7.5 degrees, so 48 steps make a turn. The step rate is set by the delay; above about 500 steps/s the rotor misses steps.",
    steps: ["Run and watch the rotor.", "Reduce DELAY below 2 ms and see missed steps.", "Use half-stepping (8 states) for 3.75 degrees."],
    questions: ["How many steps for 90 degrees?", "How do you reverse direction?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        MVI A,80H
        OUT 23H         ; 8255 #3 outputs
        MVI D,12        ; 12 x 4 = 48 steps
CW:     LXI H,SEQ
        MVI C,04H
CW1:    MOV A,M
        OUT 20H
        CALL DELAY      ; 5 ms per step
        INX H
        DCR C
        JNZ CW1
        DCR D
        JNZ CW
        MVI A,00H
        OUT 20H
        MVI D,12
CCW:    LXI H,SEQ+3
        MVI C,04H
CCW1:   MOV A,M
        OUT 20H
        CALL DELAY
        DCX H
        DCR C
        JNZ CCW1
        DCR D
        JNZ CCW
        MVI A,00H
        OUT 20H
        HLT
${DELAY("DELAY", 0x0271)}
SEQ:    DB 03H,06H,0CH,09H`,
    run: 5e6,
    check: (k) => res(Math.abs(k.stepper.angle) < 8 && k.stepper.missed === 0 && k.stepper.steps >= 90, `net angle ${k.stepper.angle.toFixed(1)} deg (back to 0), steps=${k.stepper.steps}, missed=${k.stepper.missed}`),
  },
  {
    id: "c-traffic", group: "Motors and lamps", title: "Traffic-light controller",
    aim: "Run a two-road junction: road 1 green, yellow, then road 2 green, yellow, repeating.",
    theory: "Port B of 8255 #3 drives six lamps: bit 0 R1, bit 1 Y1, bit 2 G1, bit 3 R2, bit 4 Y2, bit 5 G2. Each phase is a fixed bit pattern held for a delay (here shortened to 1 s green and 0.3 s yellow).",
    steps: ["Run and watch the junction in the panel.", "Add an all-red clearance phase.", "Lengthen the green time."],
    questions: ["Why must both roads never be green together?", "How would a pedestrian button be added using an interrupt?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        MVI A,80H
        OUT 23H
CYCLE:  MVI A,0CH       ; G1 + R2
        OUT 21H
        LXI D,03E8H
        CALL WAIT
        MVI A,0AH       ; Y1 + R2
        OUT 21H
        LXI D,012CH
        CALL WAIT
        MVI A,21H       ; R1 + G2
        OUT 21H
        LXI D,03E8H
        CALL WAIT
        MVI A,11H       ; R1 + Y2
        OUT 21H
        LXI D,012CH
        CALL WAIT
        JMP CYCLE
WAIT:   PUSH B
W1:     LXI B,0080H
W2:     DCX B
        MOV A,B
        ORA C
        JNZ W2
        DCX D
        MOV A,D
        ORA E
        JNZ W1
        POP B
        RET`,
    run: 9e6,
    check: (k) => { const o = outs(k, 0x21); return res(o.slice(0, 4).join() === [0x0c, 0x0a, 0x21, 0x11].join(), `lamp patterns: ${o.slice(0, 5).map((v) => hx(v)).join(" ")}`); },
  },
  {
    id: "c-motor", group: "Motors and lamps", title: "DC motor speed by software PWM",
    aim: "Control the average voltage on a DC motor by switching it on and off with a duty cycle held in 3000H.",
    theory: "Pulse-width modulation switches the motor fully on for N time units and off for 255-N units. The motor's inertia averages this, so speed is proportional to the duty cycle N/255. Port C bit 0 of 8255 #3 enables the driver.",
    steps: ["Run with duty 40H (25 %), then edit 3000H to C0H (75 %).", "Watch the motor graphic speed up.", "Reverse with PC1 (direction)."],
    questions: ["Why is PWM more efficient than a series resistor?", "What limits the minimum PWM frequency?"],
    code: `        ORG 2000H
        MVI A,80H
        OUT 23H
        LDA 3000H
        MOV B,A         ; B = duty (0-255)
LOOP:   MOV A,B
        ORA A
        JZ  OFFP
        MVI A,01H
        OUT 22H         ; motor on
        MOV C,B
ONL:    DCR C
        JNZ ONL
OFFP:   XRA A
        OUT 22H         ; motor off
        MVI A,0FFH
        SUB B
        JZ  LOOP
        MOV C,A
OFFL:   DCR C
        JNZ OFFL
        JMP LOOP`,
    setup: (k) => set(k, 0x3000, [0x40]),
    run: 4e5,
    check: (k) => { k.motorEn.read(k.t); k.run(300000); const d = k.motorEn.read(k.t)[0]; return res(Math.abs(d - 0.25) < 0.08, `measured duty ${(d * 100).toFixed(0)} % (expected about 25 %)`); },
  },
  // ------------------------------------------------------------------ DAC / ADC
  {
    id: "d-saw", group: "DAC and ADC", title: "DAC: sawtooth and triangle waves",
    aim: "Generate a sawtooth and a triangle wave on the DAC (port 30H) and measure them on the scope.",
    theory: "An 8-bit DAC outputs Vref x code/256. Incrementing the code in a loop produces a ramp; when the 8-bit register overflows the output falls back to zero (sawtooth). Counting up then down gives a triangle. The frequency follows from the loop time.",
    steps: ["Run and open the Scope panel.", "Measure the period and compare with the T-state count.", "Delete the second loop to get a pure sawtooth."],
    questions: ["What is the frequency of the sawtooth?", "How could you change the amplitude?"],
    code: `        ORG 2000H
SAW:    MVI C,03H       ; 3 sawtooth cycles
S1:     XRA A
S2:     OUT 30H
        INR A
        JNZ S2
        DCR C
        JNZ S1
TRI:    MVI C,03H       ; 3 triangle cycles
T1:     XRA A
UP:     OUT 30H
        INR A
        JNZ UP
        MVI A,0FFH
DN:     OUT 30H
        DCR A
        JNZ DN
        DCR C
        JNZ T1
        JMP SAW`,
    run: 2e5,
    check: (k) => { const v = k.dac.ev.filter((_, i) => i % 2 === 1); return res(v.length > 500 && Math.max(...v) === 255 && Math.min(...v) === 0, `${v.length} DAC samples, range ${Math.min(...v)}-${Math.max(...v)}`); },
  },
  {
    id: "d-square", group: "DAC and ADC", title: "DAC: square wave with adjustable duty",
    aim: "Produce a square wave whose high time is set by 3000H and low time by 3001H.",
    theory: "Alternate the DAC between 00H and FFH with delay loops. The period is the sum of the two delays and the duty cycle is high/(high+low).",
    steps: ["Run with 40H/C0H: 25 % duty.", "Measure the duty cycle on the scope.", "Make it symmetric."],
    questions: ["How is the frequency related to the sum of the loops?", "Why is the real duty slightly different from 25 %?"],
    code: `        ORG 2000H
LOOP:   MVI A,0FFH
        OUT 30H
        LDA 3000H
        MOV B,A
HI:     DCR B
        JNZ HI
        XRA A
        OUT 30H
        LDA 3001H
        MOV B,A
LO:     DCR B
        JNZ LO
        JMP LOOP`,
    setup: (k) => set(k, 0x3000, [0x40, 0xc0]),
    run: 5e4,
    check: (k) => { const ev = k.dac.ev; let hi = 0, tot = 0; for (let i = 2; i + 3 < ev.length && i < 400; i += 2) { if (ev[i + 1] === 255) hi += ev[i + 2] - ev[i]; } const t0 = ev[2], t1 = ev[ev.length - 4]; tot = t1 - t0; const duty = tot > 0 ? hi / tot : 0; return res(duty > 0.15 && duty < 0.35, `duty about ${(duty * 100).toFixed(0)} %`); },
  },
  {
    id: "d-sine", group: "DAC and ADC", title: "DAC: sine wave from a 32-point table",
    aim: "Output one sine period from a look-up table of 32 samples, repeatedly.",
    theory: "A sine wave is approximated by 32 stored amplitude values (128 + 127 sin(2 pi k/32)). The DAC steps through the table; filtering the staircase gives a smooth sine. The output frequency is 1/(32 x sample time).",
    steps: ["Run and look at the scope trace.", "Double the table length for lower distortion.", "Add a delay to lower the frequency."],
    questions: ["What is the sample rate for a 1 kHz sine?", "How does the table size affect distortion?"],
    code: `        ORG 2000H
AGAIN:  LXI H,TAB
        MVI C,32
LOOP:   MOV A,M
        OUT 30H
        INX H
        DCR C
        JNZ LOOP
        JMP AGAIN
TAB:    DB ${dbList(sine32.slice(0, 16))}
        DB ${dbList(sine32.slice(16))}`,
    run: 1e5,
    check: (k) => { const v = k.dac.ev.filter((_, i) => i % 2 === 1).slice(0, 32); return res(v.join() === sine32.join(), `first 32 samples ${v.join() === sine32.join() ? "match" : "differ from"} the table`); },
  },
  {
    id: "d-adc", group: "DAC and ADC", title: "ADC0809: potentiometer to LED bar",
    aim: "Start a conversion on channel 0, wait for end-of-conversion and show the 8-bit result on the LEDs.",
    theory: "OUT 40H selects the channel (bits 0-2) and starts the conversion. The ADC needs about 100 us; bit 0 of port 41H is the EOC flag. IN 40H then reads the result = Vin/5 V x 256.",
    steps: ["Run and drag the CH0 slider in the ADC panel.", "Compare the LED pattern with Vin x 51.2.", "Read channel 7 (fixed 5 V)."],
    questions: ["What is the resolution of the converter in volts?", "What would happen if you read before EOC?"],
    code: `        ORG 2000H
        MVI A,80H
        OUT 03H         ; port A out (LEDs)
LOOP:   MVI A,00H       ; channel 0, start
        OUT 40H
WAIT:   IN  41H
        ANI 01H         ; EOC?
        JZ  WAIT
        IN  40H         ; result
        OUT 00H
        JMP LOOP`,
    setup: (k) => { k.adc.inputs[0] = 2.5; },
    run: 5e4,
    check: (k) => res(lastOut(k, 0) === 128, `LEDs=${hx(lastOut(k, 0) ?? 0)}H for 2.50 V (expected 80H)`),
  },
  {
    id: "d-temp", group: "DAC and ADC", title: "Temperature alarm with LM35 and relay",
    aim: "Read the LM35 sensor (10 mV/degC) on channel 2 and switch a relay on above about 40 degC.",
    theory: "The LM35 output is 10 mV per degree C, so 40 degC is 0.4 V = code 20.5 at 19.5 mV per step. The program compares the ADC code with the threshold stored at 3000H (default 21) and drives relay PA4 on 8255 #3.",
    steps: ["Run and move the temperature slider.", "Watch the relay close above 41 degC.", "Add hysteresis to stop chatter."],
    questions: ["What is the temperature resolution of an 8-bit ADC at 5 V?", "Why is hysteresis needed?"],
    code: `        ORG 2000H
        MVI A,80H
        OUT 23H
LOOP:   MVI A,02H       ; channel 2 (LM35)
        OUT 40H
WAIT:   IN  41H
        ANI 01H
        JZ  WAIT
        IN  40H
        MOV B,A
        LDA 3000H       ; threshold
        MOV C,A
        MOV A,B
        CMP C
        JC  COOL        ; below threshold
        MVI A,10H       ; relay on (PA4)
        JMP OUTP
COOL:   XRA A
OUTP:   OUT 20H
        JMP LOOP`,
    setup: (k) => { set(k, 0x3000, [21]); k.adc.inputs[2] = 0.25; },
    run: 5e4,
    check: (k) => { const cool = k.relay; k.adc.inputs[2] = 0.55; k.run(60000); const hot = k.relay; return res(cool === 0 && hot === 1, `relay at 25 degC = ${cool}, at 55 degC = ${hot}`); },
  },
  // ------------------------------------------------------------------ 8253, 8251, interrupts, monitor, LCD
  {
    id: "e-tone", group: "Timer, serial and interrupts", title: "8253 square wave: speaker tone",
    aim: "Program counter 1 of the 8253 in mode 3 to produce a 1 kHz tone on the speaker.",
    theory: "The 8253 divides its 1.5 MHz clock by the loaded count. Mode 3 gives a square wave of 50 % duty. Count = 1.5 MHz / 1 kHz = 1500 (05DCH). The control word 76H selects counter 1, LSB then MSB, mode 3, binary.",
    steps: ["Run and listen (turn the speaker on in the panel).", "Try count 1000 for 1.5 kHz.", "Gate counter 1 low and note OUT1 stays high."],
    questions: ["Which control word selects counter 2, mode 2?", "What is the lowest frequency with a 16-bit count?"],
    code: `        ORG 2000H
        MVI A,76H       ; counter 1, LSB+MSB, mode 3
        OUT 53H
        MVI A,0DCH      ; count = 1500
        OUT 51H
        MVI A,05H
        OUT 51H
        HLT`,
    run: 1000,
    check: (k) => { k.advanceT(200000); const f = k.spk.freq(k.t); return res(Math.abs(f - 1000) < 15, `speaker frequency ${f.toFixed(0)} Hz (expected 1000 Hz)`); },
  },
  {
    id: "e-melody", group: "Timer, serial and interrupts", title: "8253 melody player",
    aim: "Play the notes C-D-E-F-G by reloading the counter-1 divisor from a table.",
    theory: "Each note frequency f needs a count 1.5 MHz / f. The program writes the new count and waits a fixed time per note, so the speaker plays a scale.",
    steps: ["Enable the speaker and run.", "Change the table to play a tune.", "Add rests by programming mode 0 (silent)."],
    questions: ["What count gives A = 440 Hz?", "How is the note length controlled?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        MVI A,76H
        OUT 53H
PLAY:   LXI H,NOTES
        MVI C,05H
NEXT:   MOV A,M
        OUT 51H
        INX H
        MOV A,M
        OUT 51H
        INX H
        CALL LEN
        DCR C
        JNZ NEXT
        JMP PLAY
${DELAY("LEN", 0xa000)}
NOTES:  DW 5735,5110,4552,4297,3828   ; counts for C4 D4 E4 F4 G4`,
    run: 3e5,
    check: (k) => { k.advanceT(10000); const f = k.spk.freq(k.t); return res(f > 250 && f < 400, `current note ${f.toFixed(0)} Hz`); },
  },
  {
    id: "e-timer-irq", group: "Timer, serial and interrupts", title: "8253 interrupt every 10 ms (RST 6.5)",
    aim: "Use counter 0 (mode 0) to raise RST 6.5 every 10 ms and count the interrupts in memory 3000H.",
    theory: "In mode 0 OUT0 goes high when the count reaches zero. OUT0 is jumpered to the RST 6.5 pin (level sensitive). The ISR increments a counter and reloads the 8253, which drives OUT0 low again and removes the request. SIM unmasks RST 6.5 and EI enables interrupts.",
    steps: ["Run: the LEDs show the interrupt count.", "Single-step into the ISR at 0034H.", "Remove the reload and see the interrupt repeat."],
    questions: ["Why is RST 6.5 vector 0034H?", "What would happen if the ISR did not end with EI?"],
    code: `        ORG 0000H
        JMP START
        ORG 0034H       ; RST 6.5 vector
        JMP ISR
        ORG 2000H
START:  LXI SP,27FFH
        MVI A,80H
        OUT 03H
        XRA A
        STA 3000H
        MVI A,30H       ; counter 0, LSB+MSB, mode 0
        OUT 53H
        MVI A,98H       ; 15000 = 3A98H -> 10 ms
        OUT 50H
        MVI A,3AH
        OUT 50H
        MVI A,0DH       ; SIM: MSE=1, unmask 6.5 (M6.5=0), mask 5.5 and 7.5
        SIM
        EI
IDLE:   LDA 3000H
        OUT 00H         ; show the count
        JMP IDLE
ISR:    PUSH PSW
        LDA 3000H
        INR A
        STA 3000H
        MVI A,98H       ; reload counter 0: OUT0 falls again
        OUT 50H
        MVI A,3AH
        OUT 50H
        POP PSW
        EI
        RET`,
    run: 1e6,
    check: (k) => res(mem(k, 0x3000) >= 25 && mem(k, 0x3000) <= 40, `${mem(k, 0x3000)} interrupts in ${k.t.toFixed(2)} s (about 10 ms apart)`),
  },
  {
    id: "e-rst75", group: "Timer, serial and interrupts", title: "RST 7.5 push button counter",
    aim: "Count presses of the RST 7.5 button in an interrupt service routine and show the count on the LEDs.",
    theory: "RST 7.5 is rising-edge triggered and latched, so a short pulse is not missed. After the interrupt the CPU pushes PC, clears IE and jumps to 003CH. The ISR must end with EI and RET.",
    steps: ["Run and press the RST 7.5 button on the panel.", "Check the LEDs increment.", "Mask the interrupt with SIM and press again."],
    questions: ["What is the difference between edge and level triggering?", "Why does the ISR execute EI before RET?"],
    code: `        ORG 0000H
        JMP START
        ORG 003CH       ; RST 7.5 vector
        JMP ISR
        ORG 2000H
START:  LXI SP,27FFH
        MVI A,80H
        OUT 03H
        XRA A
        STA 3000H
        OUT 00H
        MVI A,0BH       ; unmask 7.5 only
        SIM
        EI
WAIT:   JMP WAIT
ISR:    PUSH PSW
        LDA 3000H
        INR A
        STA 3000H
        OUT 00H
        POP PSW
        EI
        RET`,
    run: 3e3,
    check: (k) => { k.pressInt("7.5", true); k.pressInt("7.5", false); k.run(2000); k.pressInt("7.5", true); k.pressInt("7.5", false); k.run(2000); k.pressInt("7.5", true); k.pressInt("7.5", false); k.run(2000); return res(mem(k, 0x3000) === 3 && lastOut(k, 0) === 3, `count=${mem(k, 0x3000)} after 3 presses`); },
  },
  {
    id: "e-trap", group: "Timer, serial and interrupts", title: "TRAP: non-maskable interrupt",
    aim: "Show that TRAP works even when interrupts are disabled (DI) and that the ISR sets the flag at 3000H.",
    theory: "TRAP is non-maskable, edge and level sensitive, with the highest priority. It vectors to 0024H irrespective of IE or the SIM masks, which makes it suitable for power-fail handlers.",
    steps: ["Run (the main loop is under DI).", "Press TRAP: 3000H becomes 55H.", "Compare with RST 7.5, which stays masked."],
    questions: ["Which interrupts can be masked?", "Why is TRAP used for power-fail?"],
    code: `        ORG 0000H
        JMP START
        ORG 0024H       ; TRAP vector
        JMP ISR
        ORG 2000H
START:  LXI SP,27FFH
        XRA A
        STA 3000H
        DI
WAIT:   JMP WAIT
ISR:    MVI A,55H
        STA 3000H
        RET`,
    run: 2e3,
    check: (k) => { const before = mem(k, 0x3000); k.pressInt("TRAP", true); k.pressInt("TRAP", false); k.run(500); return res(before === 0 && mem(k, 0x3000) === 0x55, `flag before=${hx(before)}H, after TRAP=${hx(mem(k, 0x3000))}H`); },
  },
  {
    id: "e-usart", group: "Timer, serial and interrupts", title: "8251 USART: terminal echo",
    aim: "Echo every character typed in the terminal back to it, using the 8251 at ports 60H/61H.",
    theory: "After reset the 8251 expects a mode word (4EH = 8 data bits, no parity, 1 stop, x16 clock) followed by a command word (37H = TxEN, RxEN, DTR, RTS, clear errors). Status bit 1 (RxRDY) tells that a character is waiting; bit 0 (TxRDY) tells that the transmitter can accept one.",
    steps: ["Run, then type in the terminal box.", "Watch TxRDY/RxRDY in the status line.", "Change the echo to upper case with ANI 5FH."],
    questions: ["Why must the mode word be sent before the command word?", "What does the baud-rate generator provide?"],
    code: `        ORG 2000H
        MVI A,4EH
        OUT 61H         ; mode instruction
        MVI A,37H
        OUT 61H         ; command instruction
POLL:   IN  61H
        ANI 02H         ; RxRDY ?
        JZ  POLL
        IN  60H         ; received character
        MOV B,A
TX:     IN  61H
        ANI 01H         ; TxRDY ?
        JZ  TX
        MOV A,B
        OUT 60H
        JMP POLL`,
    run: 2e3,
    check: (k) => { k.usart.receive(0x48); k.run(6000); k.usart.receive(0x69); k.run(60000); return res(k.term.join() === [0x48, 0x69].join(), `terminal output: ${k.term.map((c) => String.fromCharCode(c)).join("")}`); },
  },
  {
    id: "e-monitor", group: "Keypad and monitor", title: "Monitor routines: echo keys on the display",
    aim: "Use the monitor's GETKEY (0300H) and UPDDT (0309H) routines to show each pressed key on the data display.",
    theory: "A trainer monitor provides subroutines for its keypad and display. GETKEY waits for a key and returns its code in A; UPDDT shows A on the two data digits; UPDAD shows HL on the four address digits. Programs call them like any other subroutine.",
    steps: ["Run with GO 2000 EXEC (or the Run button) and press keys 0-F.", "The last key appears in the data field.", "Show a running key counter on the address field with UPDAD."],
    questions: ["How does CALL reach a routine in ROM?", "Why does a user program need the monitor's routines?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        LXI H,0000H     ; key counter
LOOP:   CALL 0300H      ; GETKEY -> A
        CALL 0309H      ; UPDDT: show key
        INX H
        CALL 0306H      ; UPDAD: show press count
        JMP LOOP`,
    run: 200,
    check: (k) => { k.mon.keys.push(0x0a); k.run(500); k.mon.keys.push(0x03); k.run(500); return res(k.mon.progData === "03" && k.mon.progAddr === "0002", `address field ${k.mon.progAddr}, data field ${k.mon.progData}`); },
  },
  {
    id: "e-lcd", group: "Keypad and monitor", title: "16x2 LCD message (HD44780 at 70H/71H)",
    aim: "Initialise the LCD and print two lines of text.",
    theory: "An HD44780 LCD takes commands (RS = 0, port 70H) and characters (RS = 1, port 71H). The initialisation sequence sets 8-bit/2-line mode (38H), turns the display on (0CH), clears it (01H) and sets entry mode (06H). Commands take 37 us (clear takes 1.5 ms); a command sent while the busy flag (bit 7 of the status read at 70H) is set is ignored.",
    steps: ["Run and read the display.", "Remove the BUSY wait: characters get lost.", "Move the cursor with 0C0H for line 2."],
    questions: ["What does the busy flag protect?", "How do you create a custom character?"],
    code: `        ORG 2000H
        LXI SP,27FFH
        MVI A,38H       ; 8-bit, 2 lines, 5x8
        CALL CMD
        MVI A,0CH       ; display on, cursor off
        CALL CMD
        MVI A,06H       ; entry mode: increment
        CALL CMD
        MVI A,01H       ; clear
        CALL CMD
        LXI H,LINE1
        CALL PRINT
        MVI A,0C0H      ; DDRAM address 40H = line 2
        CALL CMD
        LXI H,LINE2
        CALL PRINT
        HLT
CMD:    PUSH PSW
BUSY1:  IN  70H
        ANI 80H
        JNZ BUSY1
        POP PSW
        OUT 70H
        RET
PRINT:  MOV A,M
        ORA A
        RZ
        PUSH PSW
BUSY2:  IN  70H
        ANI 80H
        JNZ BUSY2
        POP PSW
        OUT 71H
        INX H
        JMP PRINT
LINE1:  DB "VIN Technologies",0
LINE2:  DB "8085 Trainer Kit",0`,
    run: 2e5,
    check: (k) => { const v = k.lcd.view(); const s = (r) => v[r].map((c) => String.fromCharCode(c)).join(""); return res(s(0) === "VIN Technologies" && s(1) === "8085 Trainer Kit", `line1="${s(0)}" line2="${s(1)}"`); },
  },
];
