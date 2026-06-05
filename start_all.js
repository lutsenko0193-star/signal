'use strict';

/**
 * Скрипт автоматического запуска всех модулей системы
 */
const { spawn } = require('child_process');

// Настройте ваш токен здесь или через переменную окружения
const TG_TOKEN = process.env.TELEGRAM_TOKEN || 'ВАШ_ТЕЛЕГРАМ_ТОКЕН';

const services = [
    { name: 'ENGINE ', file: 'server.js' },
    { name: 'VPN_MGR', file: 'vpn_manager.js' },
    { name: 'VPN_MON', file: 'vpn_monitor.js' },
    { name: 'TG_BOT ', file: 'bot.js', env: { TELEGRAM_TOKEN: TG_TOKEN } }
];

console.log('\x1b[36m%s\x1b[0m', '=== Starting Signal Engine Infrastructure ===');

services.forEach(s => {
    const child = spawn('node', [s.file], {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, ...s.env }
    });

    child.on('error', (err) => console.error(`[${s.name}] Error:`, err));
});

process.on('SIGINT', () => {
    console.log('\nStopping all services...');
    process.exit();
});