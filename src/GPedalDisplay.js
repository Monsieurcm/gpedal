import {geocode, getPanoramaByLocation} from './lib/gmapPromises';
import {timeout} from './lib/utils';
import {CalculateRho} from './lib/air_density';
import {CalculateVelocity} from './lib/power_v_speed';
import {d3} from "./lib/d3Wrapper";
import {RoutePoint} from "./Route";
import {managedLocalStorage} from './lib/managedLocalStorage';
import {FitWriter} from '@markw65/fit-file-writer';


export class GPedalDisplay {
  constructor({id, powerMeter, heartMeter, cadenceMeter, riderWeight, unit, routeName='', history=[], points, ridingState}) {
    this.id = id;
    this.powerMeter = powerMeter;
    this.heartMeter = heartMeter;
    this.cadenceMeter = cadenceMeter;
    this.riderWeight = riderWeight;
    this.unit = unit;
    this.routeName = routeName;
    this.history = history;
    this.points = points;
    this.ridingState = ridingState;
    this.routeCompleted = false;
    this.powerSamples = [];

    if(this.id === undefined || this.id === null) {
      this.id = (new Date()).getTime();
    }

    if(typeof this.riderWeight === 'string') {
      this.riderWeight = parseInt(this.riderWeight);
    }

    if(this.ridingState === undefined || this.ridingState === null) {
      this.ridingState = {
        pointIdx: 0,
        point: this.points[0],
        pointPct: 0,
        lastSampleTime: new Date(),
        location: this.points[0].location,
        elevation: this.points[0].elevation,
        average_grade: 0,
        mapMode: 'SV',
        watts: 0,
        rpm: undefined,
        bpm: undefined,
        speed: 0,
        distance: 0,
        climb: 0,
        elapsed: 0,
      };
    }
  }

  async init() {
    this.miniMap = new google.maps.Map(document.getElementById('tracker'), {
      center: this.ridingState.point.location,
      zoom: 14,
      fullscreenControl: false,
      zoomControl: true,
      mapTypeId: google.maps.MapTypeId.TERRAIN
    });

    let simplePoints = this.points.map(p => {return {lat: p.location.lat(), lng: p.location.lng()}});
    let miniRoutePath = new google.maps.Polyline({
      path: simplePoints,
      geodesic: true,
      strokeColor: '#0c7ac9',
      strokeOpacity: 1.0,
      strokeWeight: 2
    });
    miniRoutePath.setMap(this.miniMap);

    this.fullMap = new google.maps.Map(document.getElementById('map-view'), {
      center: this.ridingState.point.location,
      zoom: 18,
      fullscreenControl: false,
      zoomControl: true,
      mapTypeId: google.maps.MapTypeId.TERRAIN
    });

    let routePath = new google.maps.Polyline({
      path: simplePoints,
      geodesic: true,
      strokeColor: '#0c7ac9',
      strokeOpacity: 1.0,
      strokeWeight: 2
    });
    routePath.setMap(this.fullMap);

    this.fullMarker = new google.maps.Marker({
        position: this.ridingState.point.location,
        map: this.fullMap,
        icon: './images/here.png'
    });
    this.fullMarker.setMap(this.fullMap);

    let streetview = this.streetViewPanoramaInit(this.ridingState.point.location, this.ridingState.point.heading);
    this.miniMap.setStreetView(streetview);

    // Init elevation graph
    this.zoomSvg = d3.select("#ui-elevation").append("svg")
      .attr("id", "ui-elevation-svg")
      .attr("x", 0)
      .attr("y", 0)
      .attr("viewBox", "0 0 150 60")
      .attr("preserveAspectRatio", "none");
    // end elevation graph

    this.drawHeightMap();

    this.powerMeter.addListener('power', power => this.collectPower(power));
    if(this.heartMeter) {
      this.heartMeter.addListener('hr', hr => this.collectHR(hr));
    }

    if(this.cadenceMeter) {
      this.cadenceMeter.addListener('cadence', cadence => this.collectCadence(cadence));
    }

    let geoResults = await geocode(this.points[0].location);
    let skipTypes = ["street_address", "route", "intersection", "postal_code"];
    for(let r of geoResults) {
      let type = '';
      if(r.types.length > 0) {
        type = r.types[0];
      }
      if(skipTypes.includes(type)) {
        continue;
      } else {
        this.routeName = r.formatted_address;
        break;
      }
    }
  }

  collectPower(power) {
    this.powerSamples.push(power);
  }

  collectHR(hr) {
    this.ridingState.bpm = hr;
  }

  collectCadence(cadence) {
    this.ridingState.rpm = cadence;
  }

  buildExportContext() {
    if(!this.history.length) {
      throw new Error('No ride history available for export');
    }

    let startEntry = this.history[0];
    let endEntry = this.history[this.history.length - 1];

    let values = key => this.history
      .map(entry => entry[key])
      .filter(value => typeof value === 'number' && Number.isFinite(value));

    let average = numbers => numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
    let max = numbers => numbers.length ? Math.max(...numbers) : 0;

    let points = [];
    let totalDistance = 0;
    let totalAscent = 0;
    let totalDescent = 0;
    let maxSpeed = 0;
    let previousEntry = undefined;
    let previousDistance = 0;

    this.history.forEach(entry => {
      let segmentDistance = 0;
      if(previousEntry) {
        segmentDistance = google.maps.geometry.spherical.computeDistanceBetween(previousEntry.location, entry.location);
        totalDistance += segmentDistance;

        let elevationDelta = entry.elevation - previousEntry.elevation;
        if(elevationDelta > 0) {
          totalAscent += elevationDelta;
        } else {
          totalDescent += Math.abs(elevationDelta);
        }
      }

      let speed = 0;
      if(previousEntry) {
        let elapsedSeconds = Math.max((entry.time - previousEntry.time) / 1000, 1);
        speed = (totalDistance - previousDistance) / elapsedSeconds;
        maxSpeed = Math.max(maxSpeed, speed);
      }

      points.push({
        speed,
        segment_distance: segmentDistance,
        distance: totalDistance,
        latitude: entry.location.lat(),
        longitude: entry.location.lng(),
        elevation: entry.elevation,
        time: entry.time,
        time_iso: entry.time.toISOString()
      });
      previousEntry = entry;
      previousDistance = totalDistance;
    });

    let totalElapsedTime = Math.max((endEntry.time - startEntry.time) / 1000, 0);
    let heartRates = values('hr');
    let cadences = values('cad');
    let powers = values('power');
    let avgSpeed = totalElapsedTime > 0 ? totalDistance / totalElapsedTime : 0;
    let avgHeartRate = average(heartRates);
    let maxHeartRate = max(heartRates);
    let avgCadence = average(cadences);
    let maxCadence = max(cadences);
    let avgPower = average(powers);
    let maxPower = max(powers);
    return {
      startEntry,
      endEntry,
      points,
      totalDistance,
      totalAscent,
      totalDescent,
      totalElapsedTime,
      avgSpeed,
      maxSpeed,
      avgHeartRate,
      maxHeartRate,
      avgCadence,
      maxCadence,
      avgPower,
      maxPower,
      serialNumber: Math.abs(Math.floor(this.id)) % 0xFFFFFFFF,
      startTimestamp: startEntry.time,
      endTimestamp: endEntry.time,
      startTimeIso: startEntry.time.toISOString(),
      endTimeIso: endEntry.time.toISOString(),
      rideName: this.routeName || 'GPedal'
    };
  }

  escapeXml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  buildFitData() {
    let exportData = this.buildExportContext();
    let fitWriter = new FitWriter();
    let fitStart = fitWriter.time(exportData.startTimestamp);
    let fitEnd = fitWriter.time(exportData.endTimestamp);

    fitWriter.writeMessage('file_id', {
      type: 'activity',
      manufacturer: 'garmin',
      product: 0,
      serial_number: exportData.serialNumber,
      time_created: fitStart,
      product_name: 'GPedal'
    }, null, true);

    exportData.points.forEach((entry, index) => {
      let record = {
        timestamp: fitWriter.time(entry.time),
        position_lat: fitWriter.latlng(entry.latitude * Math.PI / 180),
        position_long: fitWriter.latlng(entry.longitude * Math.PI / 180),
        distance: entry.distance
      };

      if(entry.elevation !== undefined && entry.elevation !== null) {
        record.altitude = entry.elevation;
      }
      if(entry.hr !== undefined && entry.hr !== null) {
        record.heart_rate = entry.hr;
      }
      if(entry.cad !== undefined && entry.cad !== null) {
        record.cadence = entry.cad;
      }
      if(entry.power !== undefined && entry.power !== null) {
        record.power = entry.power;
      }
      if(index > 0 && entry.speed !== undefined) {
        record.speed = entry.speed;
      }

      fitWriter.writeMessage('record', record);
    });

    fitWriter.writeMessage('lap', {
      event: 'lap',
      event_type: 'stop',
      start_time: fitStart,
      start_position_lat: fitWriter.latlng(exportData.startEntry.location.lat() * Math.PI / 180),
      start_position_long: fitWriter.latlng(exportData.startEntry.location.lng() * Math.PI / 180),
      end_position_lat: fitWriter.latlng(exportData.endEntry.location.lat() * Math.PI / 180),
      end_position_long: fitWriter.latlng(exportData.endEntry.location.lng() * Math.PI / 180),
      total_elapsed_time: exportData.totalElapsedTime,
      total_timer_time: exportData.totalElapsedTime,
      total_distance: exportData.totalDistance,
      avg_speed: exportData.avgSpeed,
      max_speed: exportData.maxSpeed,
      avg_heart_rate: exportData.avgHeartRate,
      max_heart_rate: exportData.maxHeartRate,
      avg_cadence: exportData.avgCadence,
      max_cadence: exportData.maxCadence,
      avg_power: exportData.avgPower,
      max_power: exportData.maxPower,
      total_ascent: exportData.totalAscent,
      total_descent: exportData.totalDescent,
      intensity: 'active',
      lap_trigger: 'session_end',
      sport: 'cycling',
      sub_sport: 'indoor_cycling',
      timestamp: fitEnd
    }, null, true);

    fitWriter.writeMessage('session', {
      event: 'session',
      event_type: 'stop',
      start_time: fitStart,
      start_position_lat: fitWriter.latlng(exportData.startEntry.location.lat() * Math.PI / 180),
      start_position_long: fitWriter.latlng(exportData.startEntry.location.lng() * Math.PI / 180),
      end_position_lat: fitWriter.latlng(exportData.endEntry.location.lat() * Math.PI / 180),
      end_position_long: fitWriter.latlng(exportData.endEntry.location.lng() * Math.PI / 180),
      total_elapsed_time: exportData.totalElapsedTime,
      total_timer_time: exportData.totalElapsedTime,
      total_distance: exportData.totalDistance,
      avg_speed: exportData.avgSpeed,
      max_speed: exportData.maxSpeed,
      avg_heart_rate: exportData.avgHeartRate,
      max_heart_rate: exportData.maxHeartRate,
      avg_cadence: exportData.avgCadence,
      max_cadence: exportData.maxCadence,
      avg_power: exportData.avgPower,
      max_power: exportData.maxPower,
      total_ascent: exportData.totalAscent,
      total_descent: exportData.totalDescent,
      total_calories: 0,
      trigger: 'manual',
      sport: 'cycling',
      sub_sport: 'indoor_cycling',
      timestamp: fitEnd
    }, null, true);

    fitWriter.writeMessage('activity', {
      total_timer_time: exportData.totalElapsedTime,
      num_sessions: 1,
      type: 'manual',
      event: 'activity',
      event_type: 'stop',
      local_timestamp: fitStart - exportData.startTimestamp.getTimezoneOffset() * 60,
      timestamp: fitEnd
    }, null, true);

    return fitWriter.finish();
  }

  buildGpxData() {
    let exportData = this.buildExportContext();
    let pointsXml = exportData.points.map(point => {
      let extensions = [];
      if(point.power !== undefined && point.power !== null) {
        extensions.push(`<power>${point.power}</power>`);
      }
      if(point.hr !== undefined && point.hr !== null) {
        extensions.push(`<gpxtpx:hr>${point.hr}</gpxtpx:hr>`);
      }
      if(point.cad !== undefined && point.cad !== null) {
        extensions.push(`<gpxtpx:cad>${point.cad}</gpxtpx:cad>`);
      }

      return [
        `<trkpt lat="${point.latitude}" lon="${point.longitude}">`,
        `  <ele>${point.elevation}</ele>`,
        `  <time>${point.time_iso}</time>`,
        extensions.length ? '  <extensions>' : null,
        extensions.length ? '    <gpxtpx:TrackPointExtension>' : null,
        ...extensions.map(extension => `      ${extension}`),
        extensions.length ? '    </gpxtpx:TrackPointExtension>' : null,
        extensions.length ? '  </extensions>' : null,
        `</trkpt>`
      ].filter(Boolean).join('\n');
    }).join('\n');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx creator="GPedal" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd">',
      ` <metadata><time>${exportData.startTimeIso}</time></metadata>`,
      ' <trk>',
      `  <name>${this.escapeXml(exportData.rideName)}</name>`,
      '  <trkseg>',
      pointsXml,
      '  </trkseg>',
      ' </trk>',
      '</gpx>'
    ].join('\n');
  }

  downloadBlob(blob, filename) {
    let objectUrl = URL.createObjectURL(blob);
    let link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  streetViewPanoramaInit(location, heading) {
    let $sv = document.getElementById("street-view");
    $sv.innerHTML = "";

    let streetview = new google.maps.StreetViewPanorama(
      $sv,
      {
        visible: true,
        fullscreenControl: false,
        clickToGo: false,
        addressControl: false,
        panControl: false,
        zoomControl: false,
        linksControl: false,
        pov: {heading: heading, pitch: 0},
        position: location
      }
    );

    streetview.addListener('status_changed', () => {
      streetview.setPov({heading: this.ridingState.point.heading, pitch: 0});
    });

    return streetview;
  }

  drawHeightMap() {
    this.fullSvg = d3.select("#ui-heightmap").append("svg")
      .attr("id", "ui-heightmap-svg")
      .attr("x", 0)
      .attr("y", 0)
      .attr("viewBox", "0 0 150 37.5")
      .attr("preserveAspectRatio", "none");

    this.fullSvgData = [];
    for(let i=0; i < this.points.length; i++) {
      this.fullSvgData.push([i, this.points[i].elevation]);
    }

    let [min, max] = d3.extent(this.fullSvgData, d => d[1]);
    if((max - min) < 125) max = min + 125;

    const zoomScaleY = d3.scaleLinear()
      .domain([max,min])
      .range([6, 33]);

    const zoomScaleX = d3.scaleLinear()
      .domain([0,this.points.length-1])
      .range([0,150]);

    this.fullSvgData = this.fullSvgData.map(d => {
        return [zoomScaleX(d[0]),zoomScaleY(d[1])];
    });

    this.fullSvgData.push([150, 37.5])
    this.fullSvgData.push([0, 37.5]);
    this.fullSvgData.push([0, this.fullSvgData[0][1]]);

    // Update
    let p = this.fullSvg.selectAll("polygon")
      .data([this.fullSvgData])
      .attr("points", d => {
        return d.map(d => {
            return [d[0],d[1]].join(",");
        }).join(" ");
      });

    // Enter
    p.enter()
      .append("polygon")
      .attr("points", d => {
        return d.map(d => {
            return [d[0],d[1]].join(",");
        }).join(" ");
      })
      .attr("fill", "#31A3CC")
      .attr("stroke", "#31A3CC")
      .attr("stroke-width", "1");
  }

  updateGraphs() {
    const graphPad = 60 * 0.32;

    let data = new Array(101);
    for(let i=0; i < data.length; i++) {
      let ptIdx = (i - 50) + this.ridingState.pointIdx;
      if(ptIdx < 0) ptIdx = 0;
      if(ptIdx >= this.points.length) ptIdx = this.points.length - 1;

      data[i] = [i, this.points[ptIdx].elevation];
    }

    let [min, max] = d3.extent(data, d => d[1]);
    if((max - min) < 50) max = min + 50;

    const zoomScaleY = d3.scaleLinear()
      .domain([max,min])
      .range([15, 60 - graphPad]);

    const zoomScaleX = d3.scaleLinear()
      .domain([0,100])
      .range([0,150]);

    data = data.map(d => {
        return [zoomScaleX(d[0]),zoomScaleY(d[1])];
    });
    data.push([150, 60])
    data.push([0, 60]);
    data.push([0, data[0][1]]);

    // Update
    let p = this.zoomSvg.selectAll("polygon")
      .data([data])
      .attr("points", d => {
        return d.map(d => {
            return [d[0],d[1]].join(",");
        }).join(" ");
      });

    // Enter
    p.enter()
      .append("polygon")
      .attr("points", d => {
        return d.map(d => {
            return [d[0],d[1]].join(",");
        }).join(" ");
      })
      .attr("fill", "#31A3CC")
      .attr("stroke", "#31A3CC")
      .attr("stroke-width", "1");

    // Update
    let m = this.zoomSvg.selectAll("image")
      .data([data[51]])
      .attr("x", d => {return d[0]-7.5})
      .attr("y", d => {return d[1]-15})
      .attr("width", "15")
      .attr("height", "15")
      .attr("xlink:href", "./images/marker.svg");

    // Enter
    m.enter()
      .append("image")
      .attr("x", d => {d[0]})
      .attr("y", d => {d[1]});

    // Update
    let f = this.fullSvg.selectAll("image")
      .data([this.fullSvgData[this.ridingState.pointIdx]])
      .attr("x", d => {return d[0]-3})
      .attr("y", d => {return d[1]-6})
      .attr("width", "6")
      .attr("height", "6")
      .attr("xlink:href", "./images/marker.svg");

    // Enter
    f.enter()
      .append("image")
      .attr("x", d => {d[0]})
      .attr("y", d => {d[1]});
  }

  async updatePosition() {
    let tick = 0;

    while(true) {
      if(this.routeCompleted) {
        break;
      }

      if(this.powerSamples.length) {
        this.ridingState.watts = this.powerSamples.reduce((a, b) => a + b, 0) / this.powerSamples.length;
        this.powerSamples.length = 0
      }

      let now = new Date();
      let duration = (now - this.ridingState.lastSampleTime) / 1000;
      this.ridingState.lastSampleTime = now;

      let capacity_remaining = 1;
      let total_distance = 0;
      let average_grade = 0;

      while(capacity_remaining > 0) {
        //console.log(this.ridingState.point.smoothedGrade, this.ridingState.point.grade, this.ridingState.point.elevation, this.ridingState.pointIdx);
        let velocity = this.speedFromPower(this.ridingState.watts, this.ridingState.point.smoothedGrade,
          this.ridingState.point.elevation);
        let smoothed_velocity = this.ridingState.speed + ((velocity - this.ridingState.speed) * 0.2);
        if(this.ridingState.watts < 50 && smoothed_velocity < 0.447) {
          smoothed_velocity = 0;
        }
        let can_travel = smoothed_velocity * duration * capacity_remaining;
        let distance_left = this.ridingState.point.distance - (this.ridingState.point.distance * this.ridingState.pointPct);

        if(can_travel > distance_left) {
          let capacity_used = distance_left / can_travel;
          average_grade += this.ridingState.point.smoothedGrade * capacity_used;

          capacity_remaining = capacity_remaining - (capacity_remaining * capacity_used);
          this.ridingState.pointIdx += 1;
          this.ridingState.pointPct = 0;
          this.ridingState.climb += this.ridingState.point.climb;
          this.ridingState.point = this.points[this.ridingState.pointIdx];
          total_distance += distance_left;
          if(this.ridingState.pointIdx >= this.points.length) {
            break;
          }
        } else {
          let capacity_used = capacity_remaining;
          average_grade += this.ridingState.point.smoothedGrade * capacity_used;

          capacity_remaining = 0;
          if(distance_left !== 0) {
            this.ridingState.pointPct = 1 - ((distance_left - can_travel) / this.ridingState.point.distance);
            //console.log(this.ridingState.speed, velocity, smoothed_velocity, can_travel, distance_left, this.ridingState.pointPct);
            total_distance += can_travel;
          } else {
            this.ridingState.pointPct = 0;
          }
        }
      }

      if(this.ridingState.pointIdx >= this.points.length) {
        break;
      }

      this.ridingState.average_grade = average_grade;
      this.ridingState.distance += total_distance;
      this.ridingState.elevation = this.ridingState.point.elevation + (this.ridingState.point.opposite * this.ridingState.pointPct);
      this.ridingState.speed = (total_distance / duration);
      if(this.ridingState.speed > 0) {
        this.ridingState.elapsed += duration;
      }

      this.ridingState.location = google.maps.geometry.spherical.interpolate(this.ridingState.point.location,
        this.points[this.ridingState.pointIdx+1].location, this.ridingState.pointPct);

      this.history.push({
          time: now,
          location: this.ridingState.location,
          power: this.ridingState.watts,
          elevation: this.ridingState.elevation,
          hr: this.ridingState.bpm,
          cad: this.ridingState.rpm
      });

      if(tick % 5 === 0) {
        let streetview = this.miniMap.getStreetView();
        try {
          let data = await getPanoramaByLocation(this.ridingState.location, 50);

          // Is this a user submitted panorama?  If so, don't display it.
          if(!('profileUrl' in data.location)) {
            if(this.ridingState.mapMode === 'MV') {
              document.getElementById('map-view').style.display = 'none';
              document.getElementById('tracker').style.display = 'block';
              document.getElementById('street-view').style.display = 'block';
              streetview.setVisible(true);
              google.maps.event.trigger(streetview, 'resize');
              google.maps.event.trigger(this.miniMap, 'resize');
            }

            this.miniMap.panTo(this.ridingState.location);
            if(this.ridingState.mapMode === 'MV') {
              streetview.setPano(data.location.pano);
            } else {
              streetview.setPosition(this.ridingState.location);
            }
            this.ridingState.mapMode = 'SV';
          }
        } catch (error) {
          // streetview not available
          if(this.ridingState.mapMode === 'SV') {
            streetview.setVisible(false);
            document.getElementById('street-view').style.display = 'none';
            document.getElementById('tracker').style.display = 'none';
            document.getElementById('map-view').style.display = 'block';
            google.maps.event.trigger(this.fullMap, 'resize');
          }

          this.ridingState.mapMode = 'MV';
          this.fullMap.panTo(this.ridingState.location);
          this.fullMarker.setPosition(this.ridingState.location);
        }

        //console.log(this.ridingState.location.lat(), this.ridingState.location.lng(), this.ridingState.point.heading);
      }

      if(tick % 30 === 0) {
        Promise.resolve().then(() => {
          managedLocalStorage.set(this.cacheName(), this);
        });
      }

      this.updateGraphs();

      tick += 1;
      await timeout(1000);
    }

    this.routeCompleted = true;
  }

  speedFromPower(power, grade, elevation) {
    let temp = 23.8889;
    let pressure = Math.exp(-elevation / 7000) * 1000;
    let dew = 7.5;

    let options = {
      units: 'metric',
      // Rider Weight
      rp_wr: this.riderWeight * (this.unit === 'imperial' ? 0.453592 : 1),
      // Bike Weight
      rp_wb: 8,
      //  Frontal area A(m2)
      rp_a: 0.65,
      // Drag coefficient Cd
      rp_cd: 0.63,
      // Drivetrain loss Lossdt (%)
      rp_dtl: 4,
      // Coefficient of rolling resistance Crr
      ep_crr: 0.005,
      // Grade %
      ep_g: grade,
      ep_rho: CalculateRho(temp, pressure, dew)
    }

    let velocity = CalculateVelocity(power, options);
    // convert to m/s
    velocity = velocity * 0.277778;

    return velocity;
  }

  async updateUI() {
    while(true) {
      if(this.routeCompleted) {
        break;
      }

      let sec_num = this.ridingState.elapsed.toFixed();
      let hours   = Math.floor(sec_num / 3600);
      let minutes = Math.floor((sec_num - (hours * 3600)) / 60);
      let seconds = sec_num - (hours * 3600) - (minutes * 60);
      //if (hours   < 10) {hours   = "0"+hours;}
      if (minutes < 10) {minutes = "0"+minutes;}
      if (seconds < 10) {seconds = "0"+seconds;}
      let time;
      if(hours !== 0) {
        time = hours+':'+minutes+':'+seconds;
      } else {
        time = minutes+':'+seconds;
      }

      let distance = (this.ridingState.distance * (this.unit === 'imperial' ? 0.000621371 : 0.001));
      if(distance >= 100) {
        distance = distance.toFixed();
      } else {
        distance = distance.toFixed(1);
      }

      let grade = this.ridingState.average_grade.toFixed(1);
      if(grade === '-0' || grade === '-0.0') {
        grade = '0.0';
      }
      let $grade = document.getElementById('grade-unit-icon');
      if(grade >= 0) {
        if($grade.classList.contains('fa-long-arrow-down')) {
          $grade.classList.remove('fa-long-arrow-down');
          $grade.classList.add('fa-long-arrow-up');
        }
      } else {
        if($grade.classList.contains('fa-long-arrow-up')) {
          $grade.classList.remove('fa-long-arrow-up');
          $grade.classList.add('fa-long-arrow-down');
        }
      }

      let watts = this.ridingState.watts;
      if(watts !== undefined && watts !== null) {
        watts = watts.toFixed();
      } else {
        watts = '--';
      }

      let bpm = this.ridingState.bpm;
      if(bpm !== undefined && bpm !== null) {
        bpm = bpm.toFixed();
      } else {
        bpm = '--';
      }

      let rpm = this.ridingState.rpm;
      if(rpm !== undefined && rpm !== null) {
        rpm = rpm.toFixed();
      } else {
        rpm = '--';
      }

      document.getElementById('watts').innerHTML = watts;
      document.getElementById('heart').innerHTML = bpm;
      document.getElementById('cadence').innerHTML = rpm;
      document.getElementById('speed').innerHTML = (this.ridingState.speed * (this.unit === 'imperial' ? 2.23694 : 3.6)).toFixed();
      document.getElementById('distance').innerHTML = distance;
      document.getElementById('climb').innerHTML = (this.ridingState.climb * (this.unit === 'imperial' ? 3.28084 : 1)).toFixed();
      document.getElementById('time').innerHTML = time;
      document.getElementById('grade').innerHTML = grade;

      document.getElementById('distance-unit-value').innerHTML = this.unit === 'imperial' ? 'mi' : '&nbsp;km';
      document.getElementById('speed-unit-value').innerHTML = this.unit === 'imperial' ? 'mph' : 'kph';
      document.getElementById('climb-container-value').innerHTML = this.unit === 'imperial' ? 'ft' : 'm';

      await timeout(1000);
    }
  }

  async downloadExport() {
    let $button = document.getElementById('btn-download-fit');
    if(!$button.classList.contains('disabled')) {
      $button.classList.add('disabled');
    } else {
      return;
    }

    let $format = document.getElementById('export-format');
    let format = $format ? $format.value : 'fit';
    let filename = format === 'gpx' ? 'activity.gpx' : 'activity.fit';

    $button.innerHTML = 'Téléchargement...';

    try {
      let blob;
      if(format === 'gpx') {
        blob = new Blob([this.buildGpxData()], {type: 'application/gpx+xml'});
      } else {
        blob = new Blob([this.buildFitData()], {type: 'application/vnd.garmin.fit'});
      }

      this.downloadBlob(blob, filename);

      this.routeCompleted = true;
      managedLocalStorage.remove('route-progress', this.cacheName());
      $button.innerHTML = 'Téléchargé !';
    } catch(error) {
      console.log('Error: ', error);
      $button.innerHTML = 'Télécharger';
      $button.classList.remove('disabled');
      throw error;
    }
  }

  showFinalizeUI(msg) {
    document.getElementById('ui-finalize-container').style.display = 'block';
    document.getElementById('ui-finalize-label').innerHTML = msg;
    document.getElementById('export-format').style.display = 'block';
    let $button = document.getElementById('btn-download-fit');
    $button.style.display = 'block';
    $button.onclick = e => {
      e.preventDefault();

      this.downloadExport()
        .catch(error => {
          console.log('Error: ', error);
        });
    };
  }

  cacheName() {
    return "route-progress-"+this.id;
  }

  toJSON() {
    let {history, id, points, riderWeight, ridingState, routeName, unit} = this;

    history = history.map(h => {
      h = Object.assign({}, h);
      h.location = h.location.toJSON();
      h.time = h.time.toJSON();
      return h;
    });

    points = points.map(p => {return p.toJSON()});

    ridingState = Object.assign({}, ridingState);
    ridingState.lastSampleTime = ridingState.lastSampleTime.toJSON();
    ridingState.location = ridingState.location.toJSON();
    ridingState.point = ridingState.point.toJSON();
    ridingState.bpm = undefined;
    ridingState.rpm = undefined;
    ridingState.speed = 0;
    ridingState.watts = 0;

    return {history, id, points, riderWeight, ridingState, routeName, unit};
  }

  static fromJSON(obj) {
    for(let h of obj.history) {
      h.location = new google.maps.LatLng(h.location.lat, h.location.lng);
      h.time = new Date(h.time);
    }

    obj.points = obj.points.map(p => {return RoutePoint.fromJSON(p)});

    obj.ridingState.lastSampleTime = new Date(obj.ridingState.lastSampleTime);
    obj.ridingState.location = new google.maps.LatLng(obj.ridingState.location.lat, obj.ridingState.location.lng);
    obj.ridingState.point = RoutePoint.fromJSON(obj.ridingState.point);

    return new GPedalDisplay(obj);
  }

  static transitionUI() {
    document.getElementById('configure-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
  }
}
