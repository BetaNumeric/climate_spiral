# **Climate Spiral**

 
[**Live Demo**](https://betanumeric.github.io/climate_spiral/)


https://github.com/user-attachments/assets/4862e111-25a3-417e-994f-fd50bbe4f3ba



An interactive 3D web visualization of global temperature anomalies from 1880 to the present. This project creates a spiraling "time-volume" where each volution represents one orbit of the earth and the radius represents the temperature deviation from the 1951-1980 baseline, helping to visualize the accelerating trend of global warming.

It can also visualize atmospheric CO2 data measured at Mauna Loa from 1958 to the present.

## **Controls and Usage**

The animation plays automatically upon loading. You can control the playback using the timeline and buttons at the bottom of the screen.

* **Rotate:** Left-click and drag to rotate the spiral.  
* **Zoom:** Use the mouse scroll wheel.  
* **Move:** Right-click and drag (requires "Free Camera" to be enabled in the settings).

Click the gear icon to access settings. Here you can toggle between an orthographic and 3D perspective view, adjust the animation speed, or toggle visual helpers like the grid and labels.

You can switch between **Temperature** and **CO2** in the settings panel.

To update the data, you can click "Fetch Latest" in the settings menu (which uses a proxy) or drag and drop a supported raw data file into the browser window.

## **Mobile / PWA**

This app includes a web app manifest and service worker, so it can be installed to iPhone and Android home screens and run in **standalone** mode (click "Add to Home Screen" in Settings).

## **Background and Inspiration**

This project is a 3D implementation of the "Climate Spiral" concept originally visualized by climate scientist Ed Hawkins from the University of Reading in 2016\.

* Original Concept: [Wikipedia: Climate Spiral](https://en.wikipedia.org/wiki/Climate_spiral)  
* NASA Visualization: [Scientific Visualization Studio](https://svs.gsfc.nasa.gov/5190/)



https://github.com/user-attachments/assets/5eb3508c-af42-4f4c-8416-544912cfbda7



## **Data Source**

The data used in this visualization comes from:

* **NASA GISS Surface Temperature Analysis (GISTEMP v4)**  
  Source: [NASA GISS Surface Temperature Analysis](https://data.giss.nasa.gov/gistemp/)  
  Raw Data File: [GLB.Ts+dSST.txt](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt)
* **NOAA GML Mauna Loa CO2 trend (monthly mean)**  
  Source: [NOAA GML CO2 Trends](https://gml.noaa.gov/ccgg/trends/mlo.html)  
  Raw Data File: [co2_mm_mlo.txt](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt)

## **Technologies**

This project is built using HTML5, CSS3, and JavaScript (ES6). The 3D rendering logic is handled by the Three.js library.

## **License**

This project is licensed under the MIT License. Feel free to modify and share.
