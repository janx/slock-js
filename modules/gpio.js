var fs       = require("fs");
var gpioPath = '/sys/class/gpio/';

/**
 *  changes the value of an entry within the gpio-export.
 *  For more Details of available params, see 
 *  https://www.kernel.org/doc/Documentation/gpio/sysfs.txt
 * 
 */
function setGpioValue(pin, param, value, runAfter) {
  fs.writeFile(gpioPath + "gpio" + pin + "/" + param, value, function (err) {
    if (err) throw "Error trying to set the value for " + param + " of pin " + pin + " to " + value + " : " + err;
    console.log("Changed " + param + " of Pin " + pin + " to " + value);
    if (runAfter) runAfter();
	 });
}

/**
 * initializes a pin by writing the pinnumber to /sys/class/gpio/export 
 * and setting the direction to out
 */
function initPin(pin, runAfter) {
  fs.writeFile(gpioPath + "export", pin, function (err) {
    if (err) throw "Error trying to create the pin " + pin + ":" + err;
    setGpioValue(pin, "direction", "out", runAfter);
  });
}

/**
 * checks if the pin was exported and initializes if not
 */
function checkPin(pin, runAfter) {
  fs.exists(gpioPath + "gpio" + pin + "/value", function (exists) {
    if (exists)
		    runAfter();
    else
		    initPin(pin, runAfter);
  });
}

module.exports = function () {
  this.init = function (arg) {
    console.log("Start GPIO ...");
    this.events.on('changeState', function (arg) {
      if (arg.config.gpio) {
        console.log('GPIO : open ' + arg.id + "=" + arg.open);
        checkPin(arg.config.gpio, function () {
          setGpioValue(arg.config.gpio, "value", arg.open ? 0 : 1);
        });
      }
	   });
  };
};