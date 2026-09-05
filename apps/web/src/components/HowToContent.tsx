import {
  BET_WINDOW_SECONDS,
  MAX_HELD_SHELLS,
  MAX_HELD_SHIELDS,
  MAX_STAKE,
  MIN_STAKE,
  PLAYER_DAILY_EARN_CAP,
  PLAYER_DAILY_GRANT,
  PLAYER_WIN_GRANT,
  SHELL_COOLDOWN_HOURS,
  SHELL_CHASER_LIMIT,
  SHELL_PRICE_COINS,
  SHIELD_PRICE_COINS,
  SPECTATOR_DAILY_GRANT,
  COIN_WALLET_CAP,
} from '@challenge/core/domain';

import { HowToButton } from './HowTo';

/**
 * The three explainers, written once here rather than inline in each panel.
 *
 * Every number in them is read from the module that enforces it, so a price or
 * a window cannot be changed in the rules and left stale in the help — which is
 * the failure mode of hand-written documentation about a live system.
 */

export function ShellsHowTo() {
  return (
    <HowToButton
      title="Cómo van las conchas"
      intro="Una concha azul le asigna a otro un reto que tiene que cumplir en su siguiente partida."
      accent="var(--color-mark-blue)"
      steps={[
        {
          title: 'Conseguí una',
          body: `Se ganan jugando bien — y jugando mal — o se compran por ${SHELL_PRICE_COINS} monedas en la tienda. Podés guardar hasta ${MAX_HELD_SHELLS} sin tirar.`,
        },
        {
          title: 'Elegí a quién',
          body: 'Cualquiera del roster. La ruleta decide el reto: vos elegís la víctima, no el castigo.',
        },
        {
          title: 'Se cumple en la siguiente',
          body: 'El reto va a su próxima partida, no cuando le venga bien. Si lo saltea, después lo cumple dos veces.',
        },
      ]}
      notes={[
        `Al líder se le puede tirar siempre, sin espera.`,
        `Del 2.º al ${SHELL_CHASER_LIMIT}.º quedan a salvo ${SHELL_COOLDOWN_HOURS.chasers} h después de recibir una.`,
        `Del ${SHELL_CHASER_LIMIT + 1}.º para abajo, ${SHELL_COOLDOWN_HOURS.pack} h.`,
        'Si tu objetivo lleva escudo, la concha se rompe contra él y la perdés igual. Se ve en la lista antes de tirar.',
        'Una tirada bloqueada por espera no te cuesta nada: ni siquiera sale.',
      ]}
    />
  );
}

export function ShopHowTo() {
  return (
    <HowToButton
      title="Cómo va la tienda"
      intro="Todo se paga con monedas, y las monedas se ganan despacio a propósito."
      accent="var(--color-gold)"
      steps={[
        {
          title: 'Ganá monedas',
          body: `Si jugás: ${PLAYER_DAILY_GRANT} por día y ${PLAYER_WIN_GRANT} por victoria, hasta ${PLAYER_DAILY_EARN_CAP} al día. Si solo mirás: ${SPECTATOR_DAILY_GRANT} por día.`,
        },
        {
          title: 'Gastalas',
          body: `Una concha cuesta ${SHELL_PRICE_COINS} y un escudo ${SHIELD_PRICE_COINS}. La cartera aguanta ${COIN_WALLET_CAP}, así que ahorrar de más no sirve.`,
        },
        {
          title: 'El escudo se activa solo',
          body: `No hay nada que encender. Desde que lo comprás, la próxima concha que te tiren se rompe contra él. Podés llevar ${MAX_HELD_SHIELDS}.`,
        },
      ]}
      notes={[
        'Los escudos se ven en la lista: quien te vaya a tirar sabe que lo tenés.',
        'El que tira pierde la concha igual, aunque la pare tu escudo.',
        'Los espectadores compran conchas pero no escudos: nadie puede tirarles.',
      ]}
    />
  );
}

export function BetsHowTo() {
  return (
    <HowToButton
      title="Cómo se apuesta"
      intro="Apostás monedas a si alguien gana la partida que está jugando ahora mismo."
      accent="var(--color-mark-teal)"
      steps={[
        {
          title: 'Buscá una partida en curso',
          body: `Solo se puede entrar en los primeros ${Math.round(BET_WINDOW_SECONDS / 60)} minutos. Pasado eso la partida ya se está decidiendo y la apuesta se cierra.`,
        },
        {
          title: 'Poné tu apuesta',
          body: `Entre ${MIN_STAKE} y ${MAX_STAKE} monedas. Se te descuentan al apostar, no al final.`,
        },
        {
          title: 'Esperá el resultado',
          body: 'Cuando la partida termina y entra en la siguiente sincronización, se paga sola. No hay que reclamar nada.',
        },
      ]}
      notes={[
        'Si la partida se cae o queda en remake, se te devuelve lo apostado.',
        'Podés apostar por vos mismo.',
      ]}
    />
  );
}
