// Leonardo -> manette USB : essai brut des 12 entrées analogiques.
// Bibliothèque : ArduinoJoystickLibrary (MHeironimus), 11 axes au plus.
// Les 11 premières entrées sont des axes ; Temps (A3) devient 3 boutons.
#include <Joystick.h>

// Sans bouton ni chapeau ; 3 boutons pour Temps.
Joystick_ joy(0x03, JOYSTICK_TYPE_JOYSTICK, 3, 0,
              true, true, true, true, true, true,   // X Y Z Rx Ry Rz
              true, true, true, true, true);        // Rudder Throttle Accelerator Brake Steering

// Ordre des axes : X Y Z Rx Ry Rz Rudder Throttle Accelerator Brake Steering
// Câblage réel du tableau (22/10), pas celui de MATERIEL §7 : irisation A7,
// sensibilité A8, icônes A6, zoom A10, joystick X A11, joystick Y A9.
const uint8_t PINS[11] = {A0, A1, A2, A4, A5, A7, A8, A6, A10, A11, A9};
//                        météo légendes chance terre mer irisation sensibilité icônes zoom joyX joyY

void setup() {
  joy.begin(false);                 // un seul rapport par tour, pas un par axe
}

void loop() {
  int v[11];
  for (uint8_t i = 0; i < 11; i++) {
    analogRead(PINS[i]);                                         // lecture jetée : laisse le convertisseur se caler sur la source (inutile pour une broche libre)
    v[i] = analogRead(PINS[i]);                                  // 0..1023, plage par défaut
    if (i < 8 || i == 9) v[i] = 1023 - v[i];  // câblés à l'envers : 8 rotatifs (pas Zoom) et joystick X
  }
  joy.setXAxis(v[0]);   joy.setYAxis(v[1]);   joy.setZAxis(v[2]);
  joy.setRxAxis(v[3]);  joy.setRyAxis(v[4]);  joy.setRzAxis(v[5]);
  joy.setRudder(v[6]);  joy.setThrottle(v[7]); joy.setAccelerator(v[8]);
  joy.setBrake(v[9]);   joy.setSteering(v[10]);

  analogRead(A3);                   // lecture jetée, comme ci-dessus
  int t = 1023 - analogRead(A3);    // Temps : 3 positions ; à l'envers comme les rotatifs
  joy.setButton(0, t < 341);
  joy.setButton(1, t >= 341 && t < 682);
  joy.setButton(2, t >= 682);

  joy.sendState();
  delay(5);
}
