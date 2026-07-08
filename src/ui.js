import {GPedalDisplay} from './GPedalDisplay';
import {GPXRoutePointFactory} from './Route';
import {fileRead, readCharacteristicValue} from './lib/utils';
import {VirtualPowerMeter, BlePowerCadenceMeter, BleCadenceMeter,
    BlePowerMeter, BleHRMeter, CyclingPowerMeasurementParser, AntMeterLocator,
    CycleopsMagnetoPowerCurve, BHBladeZBikeMeter} from './Meter';
import {managedLocalStorage} from './lib/managedLocalStorage';
import URLSearchParams from '@ungap/url-search-params';
import fscreen from 'fscreen';


export async function registerUI() {
  let thisLocationURL = new URL(window.location);
  let params = new URLSearchParams(thisLocationURL.search);

  let proto = window.location.protocol;
  let isAnt = (params.get('useant') === 'true');
  let isSerial = (params.get('useserial') === 'true');
  let isBle = (!isAnt && !isSerial);

  let routes = managedLocalStorage.container('route-progress');
  let $previous = document.getElementById('continue-previous');
  for(let r of routes) {
    try {
      let route = managedLocalStorage.get(r);
      var $option = document.createElement("option");
      let routeDate = new Date();
      routeDate.setTime(route.id);

      $option.innerHTML = routeDate.toLocaleDateString() + " " + routeDate.toLocaleTimeString() + " - " + route.routeName;
      $option.setAttribute('value', r);
      $previous.add($option);
    } catch(err) {
      // Is data stored in old format?  Clear localStorage and reload.
      localStorage.clear();
      location.reload();
      break;
    }
  }

  let powerMeters = [
    ['virtual', new VirtualPowerMeter()],
    ['cycleopsmagnetopowercurve', new CycleopsMagnetoPowerCurve()]
  ]

  let heartMeters = []

  let cadenceMeters = []

  let mapDisplay;

  let $gpx = document.getElementById('gpx-file-upload');
  let $unit = document.getElementById('display-unit');
  let $weight = document.getElementById('rider-weight');
  let $btn = document.getElementById('begin-session');
  let $btntxt = document.getElementById('btn-bluetooth-device-txt');
  let $atntxt = document.getElementById('btn-ant-device-txt');
  let $stntxt = document.getElementById('btn-serial-device-txt');
  let $blt = document.getElementById('btn-bluetooth-device');
  let $alt = document.getElementById('btn-ant-device');
  let $slt = document.getElementById('btn-serial-device');
  let $pm = document.getElementById('power-meter');
  let $hm = document.getElementById('hr-meter');
  let $cm = document.getElementById('cadence-meter');
  let $mob = document.getElementById('menuopen-btn');
  let $fsc = document.getElementById('btn-fullscreen');
  let $blecontainer = document.getElementById('bluetooth-device-container');
  let $antcontainer = document.getElementById('ant-device-container');
  let $serialcontainer = document.getElementById('serial-device-container');
  let $antwsurl = document.getElementById('ant-ws-url');
  let $msg = document.getElementById('messages');

  let showErrorMessage = (msg) => {
    $msg.innerHTML = msg;
    $msg.style.display = 'block';
    window.scrollTo(0, 0);
  };

  let hideErrorMessage = () => {
    $msg.innerHTML = '';
    $msg.style.display = 'none';
  };

  let waitForGoogleMaps = (timeoutMs = 12000) => {
    return new Promise((resolve, reject) => {
      let start = Date.now();

      let checkReady = () => {
        if(window.google && window.google.maps) {
          resolve();
          return;
        }

        if((Date.now() - start) >= timeoutMs) {
          let origin = window.location.origin;
          let path = window.location.pathname;
          let basePath = path.endsWith('/') ? path : path.substring(0, path.lastIndexOf('/') + 1);
          let currentURL = `${origin}${path}`;

          let suggestedRoot = origin + '/*';
          let suggestedPath = `${origin}${basePath}*`;
          if(origin.includes('localhost') || origin.includes('127.0.0.1')) {
            suggestedRoot = origin.startsWith('https://') ? 'https://localhost/*' : 'http://localhost/*';
            suggestedPath = origin.startsWith('https://') ? 'https://127.0.0.1/*' : 'http://127.0.0.1/*';
          }

          reject(new Error(
            `Google Maps did not load for this site (${currentURL}). ` +
            `Authorize these referrers in your API key restrictions: ${suggestedRoot} and ${suggestedPath}.`
          ));
          return;
        }

        setTimeout(checkReady, 120);
      };

      checkReady();
    });
  };

  let redrawMeters = device => {
    $pm.options.length = 0;
    for(let [key, pm] of powerMeters) {
      var $option = document.createElement("option");
      $option.innerHTML = pm.name;
      $option.setAttribute('value', pm.id);
      if(pm.id === device.id) {
        $option.setAttribute('selected', 'true');
      }
      $pm.add($option);
    }
    if($pm.value === 'virtual' && powerMeters.length > 1) {
      $pm.options[0].setAttribute('selected', 'true');
    }

    $hm.options.length = 0;
    for(let [key, hm] of heartMeters) {
      var $option = document.createElement("option");
      $option.innerHTML = hm.name;
      $option.setAttribute('value', hm.id);
      if(hm.id === device.id) {
        $option.setAttribute('selected', 'true');
      }
      $hm.options.add($option);
    }

    if($hm.options.length === 0) {
      var $option = document.createElement("option");
      $option.innerHTML = 'Disabled';
      $option.setAttribute('value', '');
      $hm.options.add($option);
    }

    //

    $cm.options.length = 0;
    for(let [key, cm] of cadenceMeters) {
      var $option = document.createElement("option");
      $option.innerHTML = cm.name;
      $option.setAttribute('value', cm.id);
      if(cm.id === device.id) {
        $option.setAttribute('selected', 'true');
      }
      $cm.options.add($option);
    }

    if($cm.options.length === 0) {
      var $option = document.createElement("option");
      $option.innerHTML = 'Disabled';
      $option.setAttribute('value', '');
      $cm.options.add($option);
    }
  };

  /**
  Route tab switching handler
  */
  for(let $a of document.querySelectorAll('#route-nav a')) {
    $a.onclick = (e) => {
      e.preventDefault();
      let selector = e.target.getAttribute('href');

      for(let $p of document.querySelectorAll('.nav-link')) {
        $p.classList.remove('active');
      }
      e.target.classList.add('active');

      for(let $p of document.querySelectorAll('.tab-pane')) {
        $p.classList.remove('active');
      }
      document.querySelector(selector).classList.add('active');
    };
  }

  /**
  Unit change Handler
  */
  $unit.onchange = (e) => {
    if($unit.value === 'imperial') {
      document.getElementById('rider-weight-label').innerHTML = 'Rider Weight (lbs)';
      document.getElementById('rider-weight').setAttribute('placeholder', 185);
    } else {
      document.getElementById('rider-weight-label').innerHTML = 'Rider Weight (kg)';
      document.getElementById('rider-weight').setAttribute('placeholder', 85);
    }
  };

  /**
  Menu open Handler
  */
  $mob.onclick = (e) => {
    e.preventDefault();
    if(document.getElementById('ui-finalize-container').style.display === 'none') {
      mapDisplay.showFinalizeUI("Complete Ride");
    } else {
      document.getElementById('ui-finalize-container').style.display = 'none';
    }
  };

  /**
  Fullscreen button
  */
  $fsc.onclick = (e) => {
    e.preventDefault();

    if (fscreen.fullscreenElement !== null) {
      fscreen.exitFullscreen();
    } else {
      fscreen.requestFullscreen(document.body);
    }
  };

  /**
  Bluetooth Button Handler
  */
  $blt.onclick = (e) => {
    e.preventDefault();

    if (typeof navigator === 'undefined' || !("bluetooth" in navigator)) {
      // web bluetooth not available
      document.getElementById('btn-bluetooth-device').style.display = 'none';
      document.getElementById('btn-bluetooth-device-warning').style.display = 'block';
      return;
    }

    if(!$blt.classList.contains('disabled')) {
      $blt.classList.add('disabled');
    } else {
      return;
    }

    $btntxt.innerHTML = "Connecting ...";
    (async function() {
      let device = await navigator.bluetooth.requestDevice({
        filters: [
          // https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.service.heart_rate.xml
          {services: [0x180D]},
          // https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.service.cycling_power.xml
          {services: [0x1818]},
          // https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.service.cycling_speed_and_cadence.xml
          {services: [0x1816]}]
      });
      let server = await device.gatt.connect();

      let meter = undefined;
      // org.bluetooth.service.cycling_power
      if(!powerMeters.find(m => m[0] === device.id)) {
        let service = undefined;
        try {
          service = await server.getPrimaryService(0x1818);
        } catch(error){}

        if(service) {
          let characteristic = await service.getCharacteristic(0x2A63);
          let parser = new CyclingPowerMeasurementParser();
          let value = await readCharacteristicValue(characteristic);
          let data = parser.getData(value);

          // is Crank Revolution Data Present ?
          if('cumulative_crank_revolutions' in data) {
            meter = new BlePowerCadenceMeter(device, server, service, characteristic);
            powerMeters.push([meter.id, meter]);
            cadenceMeters.push([meter.id, meter]);
          } else {
            meter = new BlePowerMeter(device, server, service, characteristic);
            powerMeters.push([meter.id, meter]);
          }
        }
      }

      // org.bluetooth.service.cycling_speed_and_cadence
      if(!cadenceMeters.find(m => m[0] === device.id)) {
        let service = undefined;
        try {
          service = await server.getPrimaryService(0x1816);
        } catch(error) {}

        if(service) {
          let characteristic = await service.getCharacteristic(0x2A5B);
          meter = new BleCadenceMeter(device, server, service, characteristic);
          cadenceMeters.push([meter.id, meter]);
        }
      }

      // org.bluetooth.service.heart_rate
      if(!heartMeters.find(m => m[0] === device.id)) {
        let service = undefined;
        try {
          service = await server.getPrimaryService(0x180D);
        } catch(error) {}

        if(service) {
          let characteristic = await service.getCharacteristic(0x2A37);
          meter = new BleHRMeter(device, server, service, characteristic);
          heartMeters.push([meter.id, meter]);
        }
      }

      if(meter) {
        redrawMeters(meter);
      }

      $blt.classList.remove('disabled');
      $btntxt.innerHTML = "Connect";
    })()
    .catch(error => {
      $blt.classList.remove('disabled');
      $btntxt.innerHTML = "Connect";
      console.log("Error: ", error);
    });
  };

  /**
  Ant Button Handler
  */
  $alt.onclick = (e) => {
    e.preventDefault();

    if(!$alt.classList.contains('disabled')) {
      $alt.classList.add('disabled');
    } else {
      return;
    }

    $atntxt.innerHTML = "Scanning ...";
    let $anterr = document.getElementById('btn-ant-device-error');
    $antwsurl.style.display = 'none';
    $anterr.style.display = 'none';
    (async function() {
      let antwsURL = $antwsurl.value;
      localStorage.setItem('ant-ws-url', antwsURL);

      if(!antwsURL) {
        if(proto === 'https:') {
          antwsURL = 'https://localhost:4430/';
        } else {
          antwsURL = 'http://localhost:8000/';
        }
      }
      const locator = new AntMeterLocator(antwsURL);

      locator.addListener('bike_power', meter => {
        powerMeters.push([meter.id, meter]);
        redrawMeters(meter);
      });

      locator.addListener('speed_cadence', meter => {
        cadenceMeters.push([meter.id, meter]);
        redrawMeters(meter);
      });

      locator.addListener('hr', meter => {
        heartMeters.push([meter.id, meter]);
        redrawMeters(meter);
      });

      locator.addListener('namechange', meter => {
        redrawMeters(meter);
      });

      locator.addListener('error', error => {
        $antwsurl.style.display = 'inline';

        let msg_extra = '';
        if(proto === 'https:') {
          msg_extra = '<br/>You may need to allow a self signed cert for '+ locator.url + ' by clicking <a href="'+ locator.url + '" target="_blank">here</a>';
        }

        $anterr.innerHTML = '<br/> Could not connect to the ANT-WS server located at: ' + locator.url + msg_extra;
        $anterr.style.display = 'inline';

        $alt.classList.remove('disabled');
        $atntxt.innerHTML = "Scan";
      });

      locator.scan();

    })()
    .catch(error => {
      $alt.classList.remove('disabled');
      $atntxt.innerHTML = "Scan";
      console.log("Error: ", error);
    });
  };

  /**
  Serial Button Handler
  */
 $slt.onclick = (e) => {
    e.preventDefault();

    if(!$slt.classList.contains('disabled')) {
      $slt.classList.add('disabled');
    } else {
      return;
    }

    $stntxt.innerHTML = "Connecting ...";
    let $serialerr = document.getElementById('btn-serial-device-error');
    $serialerr.style.display = 'none';
    (async function() {
      let port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });

      let meter = new BHBladeZBikeMeter(port);
      powerMeters.push([meter.id, meter]);
      cadenceMeters.push([meter.id, meter]);
      redrawMeters(meter);

      $slt.classList.remove('disabled');
      $stntxt.innerHTML = "Connect";
    })()
    .catch(error => {
      $slt.classList.remove('disabled');
      $stntxt.innerHTML = "Connect";
      console.log("Error: ", error);

      $serialerr.innerHTML = '<br/> ' + error;
      $serialerr.style.display = 'inline';
    });
  };

  /**
  Begin Button Handler
  */
  $btn.onclick = (e) => {
    e.preventDefault();
    hideErrorMessage();

    if(($gpx.value || $previous.value) && $weight.value) {
      if(!$btn.classList.contains('disabled')) {
        $btn.classList.add('disabled');
      } else {
        return;
      }

      (async function() {
        let riderWeight = $weight.value;
        let unit = $unit.value;

        let heartMeterID = $hm.value;
        let heartMeter;
        if(heartMeterID) {
          let selectedHeartMeter = heartMeters.find(m => m[0] === heartMeterID);
          if(!selectedHeartMeter) {
            throw new Error('Selected heart rate monitor is no longer available.');
          }
          heartMeter = selectedHeartMeter[1];
          heartMeter.listen();
        }

        let cadenceMeterID = $cm.value;
        let cadenceMeter;
        if(cadenceMeterID) {
          let selectedCadenceMeter = cadenceMeters.find(m => m[0] === cadenceMeterID);
          if(!selectedCadenceMeter) {
            throw new Error('Selected cadence meter is no longer available.');
          }
          cadenceMeter = selectedCadenceMeter[1];
          cadenceMeter.listen();
        }

        let powerMeterID = $pm.value;
        let selectedPowerMeter = powerMeters.find(m => m[0] === powerMeterID);
        if(!selectedPowerMeter) {
          throw new Error('Selected power meter is no longer available.');
        }
        let powerMeter = selectedPowerMeter[1];
        powerMeter.listen({heartMeter, cadenceMeter});

        localStorage.setItem('form-weight', riderWeight);
        localStorage.setItem('form-unit', unit);

        await waitForGoogleMaps();

        if($previous.value) {
          let raw = managedLocalStorage.get($previous.value);
          mapDisplay = GPedalDisplay.fromJSON(raw);
          mapDisplay.powerMeter = powerMeter;
          mapDisplay.heartMeter = heartMeter;
          mapDisplay.cadenceMeter = cadenceMeter;

          managedLocalStorage.unshift('route-progress', mapDisplay.cacheName());
        } else {
          let fileBody = await fileRead($gpx.files[0]);
          let factory = new GPXRoutePointFactory(fileBody);
          let points = await factory.create();

          mapDisplay = new GPedalDisplay({points, riderWeight, unit, powerMeter, heartMeter, cadenceMeter});
          managedLocalStorage.add('route-progress', mapDisplay.cacheName(), mapDisplay);
        }

        GPedalDisplay.transitionUI();
        await mapDisplay.init();

        mapDisplay.updateUI();
        await mapDisplay.updatePosition();
        managedLocalStorage.remove('route-progress', mapDisplay.cacheName());
        mapDisplay.showFinalizeUI("Ride Finished");
      })()
      .catch(error => {
        console.log("Error: ", error);
        $btn.classList.remove('disabled');
        let errMsg = (error && error.message) ? error.message : 'Could not start the ride. Please try again.';
        showErrorMessage(errMsg);
      });
    } else {
      let msg = '';
      if(!$gpx.value && !$previous.value) {
        msg = 'Please select a GPX file.';
      } else if(!$weight.value) {
        msg = 'Please enter the riders weight.';
      }
      showErrorMessage(msg);
    }
  };

  if(localStorage.getItem('form-weight')) {
    $weight.value = localStorage.getItem('form-weight');
  }

  if(localStorage.getItem('form-unit')) {
    $unit.value = localStorage.getItem('form-unit');
    $unit.onchange();
  }

  if(localStorage.getItem('ant-ws-url')) {
    $antwsurl.value = localStorage.getItem('ant-ws-url');
  }

  if(isAnt) {
    $blecontainer.style.display = 'none';
    $antcontainer.style.display = 'block';
    $serialcontainer.style.display = 'none';
  }

  if(isSerial) {
    $blecontainer.style.display = 'none';
    $antcontainer.style.display = 'none';
    $serialcontainer.style.display = 'block';
  }

  if ('serial' in navigator) {
    for(let $l of document.querySelectorAll('.serial-switch-link')) {
      $l.style.display = 'block';
    }
  }
}
