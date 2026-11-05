export const signalLetters = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type SignalLetter = (typeof signalLetters)[number];
