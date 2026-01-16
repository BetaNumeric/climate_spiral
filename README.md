# **Climate Spiral**



https://github.com/user-attachments/assets/2af01e91-3973-4a29-9aaf-4759380e9e9d




An interactive 3D web visualization of global temperature anomalies from 1880 to the present. This project creates a spiraling "time-volume" where each volution represents one orbit of the earth and the radius represents the temperature deviation from the 1951-1980 baseline, helping to visualize the accelerating trend of global warming.


**Live Demo:** https://betanumeric.github.io/climate_spiral/


## **Controls and Usage**

The animation plays automatically upon loading. You can control the playback using the timeline and buttons at the bottom of the screen.

* **Rotate:** Left-click and drag to rotate the spiral.  
* **Zoom:** Use the mouse scroll wheel.  
* **Pan:** Right-click and drag (requires "Free Camera" to be enabled in the settings).

Click the gear icon to access settings. Here you can toggle between a 3D perspective and an orthographic view, adjust the animation speed, or toggle visual helpers like the grid and labels.

To update the data, you can either click "Fetch Latest" in the settings menu (which uses a proxy) or drag and drop the raw GLB.Ts+dSST.txt file directly into the browser window.

## **Background and Inspiration**

This project is a 3D implementation of the "Climate Spiral" concept originally visualized by climate scientist Ed Hawkins from the University of Reading in 2016\. The visualization went viral for its simple yet powerful demonstration of global temperature change.

* Original Concept: [Wikipedia: Climate Spiral](https://en.wikipedia.org/wiki/Climate_spiral)  
* NASA Visualization: [Scientific Visualization Studio](https://svs.gsfc.nasa.gov/5190/)



https://github.com/user-attachments/assets/2fc8f368-d09c-4ecf-ac36-8f89a3fb9a5d



## **Data Source**

The data used in this visualization is the GISTEMP v4 (Global Surface Temperature Analysis) provided by the NASA Goddard Institute for Space Studies (GISS).

* Source: [NASA GISS Surface Temperature Analysis](https://data.giss.nasa.gov/gistemp/)  
* Raw Data File: [GLB.Ts+dSST.txt](https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt)

## **Technologies**

This project is built using HTML5, CSS3, and JavaScript (ES6). The 3D rendering logic is handled by the Three.js library.

## **License**

This project is open source. Feel free to modify and share.



![spiral](images/spiral.mp4)
