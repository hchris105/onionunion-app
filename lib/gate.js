// lib/gate.js
let open = process.env.OPEN_REGISTER === '1';
export const isOpen = () => open;
export const openGate = () => { open = true; process.env.OPEN_REGISTER = '1'; };
export const closeGate = () => { open = false; process.env.OPEN_REGISTER = '0'; };
