// Leonardo -> manette USB : essai brut des 12 entrées analogiques.
// Bibliothèque : ArduinoJoystickLibrary (MHeironimus), 11 axes au plus.
// Les 11 premières entrées sont des axes ; Temps (A3) devient 3 boutons.
#include <Joystick.h>

// Sans bouton ni chapeau ; 3 boutons pour Temps.
Joystick_ joy(0x03, JOYSTICK_TYPE_JOYSTICK, 3, 0,
              true, true, true, true, true, true,   // X Y Z Rx Ry Rz
              true, true, true, true, true);        // Rudder Throttle Accelerator Brake Steering

// Ordre des axes : X Y Z Rx Ry Rz Rudder Throttle Accelerator Brake Steering
const uint8_t PINS[11] = {A0, A1, A2, A4, A5, A6, A7, A8, A9, A10, A11};
//                        météo légendes chance terre mer irisation sensibilité icônes zoom joyX joyY

void setup() {
  joy.begin(false);                 // un seul rapport par tour, pas un par axe
}

void loop() {
  int v[11];
  for (uint8_t i = 0; i < 11; i++) {
    analogRead(PINS[i]);                                         // lecture jetée : laisse le convertisseur se caler sur la source (inutile pour une broche libre)
    v[i] = analogRead(PINS[i]);                                  // 0..1023, plage par défaut
  }
  joy.setXAxis(v[0]);   joy.setYAxis(v[1]);   joy.setZAxis(v[2]);
  joy.setRxAxis(v[3]);  joy.setRyAxis(v[4]);  joy.setRzAxis(v[5]);
  joy.setRudder(v[6]);  joy.setThrottle(v[7]); joy.setAccelerator(v[8]);
  joy.setBrake(v[9]);   joy.setSteering(v[10]);

  analogRead(A3);                   // lecture jetée, comme ci-dessus
  int t = analogRead(A3);           // Temps : 3 positions
  joy.setButton(0, t < 341);
  joy.setButton(1, t >= 341 && t < 682);
  joy.setButton(2, t >= 682);

  joy.sendState();
  delay(5);
}
