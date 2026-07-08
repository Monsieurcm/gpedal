let elevationService;
let streetViewService;
let geocoder;

function ensureGoogleMapsReady() {
  if(typeof google === 'undefined' || !google.maps) {
    throw new Error('Google Maps API is not loaded yet.');
  }

  if(!elevationService) {
    elevationService = new google.maps.ElevationService();
  }

  if(!streetViewService) {
    streetViewService = new google.maps.StreetViewService();
  }

  if(!geocoder) {
    geocoder = new google.maps.Geocoder();
  }
}

export function geocode(location) {
  return new Promise(function(resolve,reject) {
    try {
      ensureGoogleMapsReady();
    } catch(error) {
      reject(error);
      return;
    }

    geocoder.geocode({'location': location}, function(results, status) {
      if (status === 'OK') {
        resolve(results);
      } else {
        reject(new Error(status));
      }
    });
  });
}

export function getPanoramaByLocation(location, radius) {
  return new Promise(function(resolve,reject) {
    try {
      ensureGoogleMapsReady();
    } catch(error) {
      reject(error);
      return;
    }

    let request = {
      location: location,
      radius: radius
    };
    streetViewService.getPanorama(request, (results, status) => {
      if (status == google.maps.StreetViewStatus.OK) {
        resolve(results);
      } else {
        reject(new Error(status));
      }
    });
  });
}

export function getElevationAlongPath(elevationRequest) {
  return new Promise(function(resolve,reject) {
    try {
      ensureGoogleMapsReady();
    } catch(error) {
      reject(error);
      return;
    }

    elevationService.getElevationAlongPath(elevationRequest, (results, status) => {
      if (status == google.maps.ElevationStatus.OK) {
        resolve(results);
      } else {
        reject(new Error(status));
      }
    });
  });
}
