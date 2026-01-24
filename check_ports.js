const { SerialPort } = require('serialport');

SerialPort.list().then((ports) => {
  console.log('--- ДОСТУПНЫЕ УСТРОЙСТВА ---');
  ports.forEach((port) => {
    console.log(`PATH: ${port.path}`);
    console.log(`MANUFACTURER: ${port.manufacturer}`);
    console.log(`SERIAL: ${port.serialNumber}`);
    console.log(`VENDOR ID: ${port.vendorId}`);
    console.log(`PRODUCT ID: ${port.productId}`);
    console.log('---------------------------');
  });
});
