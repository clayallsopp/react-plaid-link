import type { Actions, Provider, ProviderConnectInfo, ProviderRpcError, WatchAssetParameters } from "@web3-react/types";
import { Connector } from "@web3-react/types";
import type { PlaidWeb3, PlaidGlobalWithWeb3, Web3OnboardingOptions, EIP1193Provider } from '../types/web3';

import loadScript from './loadScript';

const PLAID_LINK_STABLE_URL =
  'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

export interface PlaidWalletOnboardConstructorArgs {
  actions: Actions;
  options: Web3OnboardingOptions;
  onError?: (error: Error) => void;
}

const parseChainId = (chainId: string | number) => {
  return typeof chainId === 'number' ? chainId : Number.parseInt(chainId, chainId.startsWith('0x') ? 16 : 10)
}

export class PlaidWalletOnboard extends Connector {
  private readonly options: Web3OnboardingOptions;
  private plaidWeb3?: PlaidWeb3;
  private eagerConnection?: Promise<void>;

  constructor({
    actions,
    options,
    onError,
  }: PlaidWalletOnboardConstructorArgs) {
    super(actions, onError);
    this.options = options;
  }

  public activate(): Promise<void> {
    const cancelActivation = this.actions.startActivation()

    return this.isomorphicInitialize().then(() => {
      const plaidWeb3 = this.plaidWeb3 as PlaidWeb3;

      const promise = new Promise<EIP1193Provider>((resolve, reject) => {
        const handler = plaidWeb3.createEthereumOnboarding({
          ...this.options,
          onSuccess: (provider) => {
            resolve(provider);
          },
          onExit: (error) => {
            reject(error);
          }
        });
        handler.open()
      });

      return promise;
    }).then((provider) => {
      this.setProvider(provider as Provider);

      // Wallets may resolve eth_chainId and hang on eth_accounts pending user interaction, which may include changing
      // chains; they should be requested serially, with accounts first, so that the chainId can settle.
      return Promise.all([
        provider.request({ method: 'eth_accounts' }),
        provider.request({ method: 'eth_chainId' })
      ]).then(([accounts, chainId]) => {
        if (!accounts.length) throw new Error('No accounts returned')

        this.actions.update({ chainId: parseChainId(chainId), accounts })
      });
    }).catch((error) => {
      cancelActivation();
      throw error;
    });
  }

  /** {@inheritdoc Connector.connectEagerly} */
  public connectEagerly(): Promise<void> {
    const cancelActivation = this.actions.startActivation()

    return this.isomorphicInitialize().then(() => {
      const plaidWeb3 = this.plaidWeb3 as Required<PlaidWeb3>;
      return plaidWeb3.getCurrentEthereumProvider(this.options.chain);
    }).then((provider) => {
      const plaidWeb3 = this.plaidWeb3 as Required<PlaidWeb3>;
      if (!provider) throw new Error('No existing connection')
      return plaidWeb3.isProviderActive(provider).then((connected) => {
        if (!connected) throw new Error('No existing connection');
      }).then(() => {
        this.setProvider(provider as Provider);
      });
    }).then(() => {
      const provider = this.provider as EIP1193Provider;
      // Wallets may resolve eth_chainId and hang on eth_accounts pending user interaction, which may include changing
      // chains; they should be requested serially, with accounts first, so that the chainId can settle.
      return Promise.all([
        provider.request({ method: 'eth_accounts' }),
        provider.request({ method: 'eth_chainId' })
      ]).then(([accounts, chainId]) => {
        if (!accounts.length) throw new Error('No accounts returned')

        this.actions.update({ chainId: parseChainId(chainId), accounts })
      });
    }).catch((error) => {
      cancelActivation();
      throw error;
    });
  }

  /** {@inheritdoc Connector.deactivate} */
  public deactivate(): Promise<void> {
    if (!this.provider || !this.plaidWeb3) return Promise.resolve();
    return this.plaidWeb3.disconnectEthereumProvider(this.provider as EIP1193Provider);
  }

  private isomorphicInitialize(): Promise<void> {
    if (this.eagerConnection) return Promise.resolve();
    this.eagerConnection = new Promise<void>((resolve, reject) => {
      loadScript(
        {
          src: PLAID_LINK_STABLE_URL,
          checkForExisting: true,
          loadImmediate: true,
        },
        ({ loading, error }) => {
          if (loading) return;
          if (error) return reject(error);
          else resolve()
        }
      );
    }).then(() => {
      const plaid = window.Plaid as PlaidGlobalWithWeb3;
      return plaid.web3();
    }).then((plaidWeb3) => {
      this.plaidWeb3 = plaidWeb3;
    });

    return this.eagerConnection;
  }

  private setProvider(provider: Provider) {
    this.provider = provider;

    this.provider.on('connect', ({ chainId }: ProviderConnectInfo): void => {
      this.actions.update({ chainId: parseChainId(chainId) })
    })

    this.provider.on('disconnect', (error: ProviderRpcError): void => {
      this.actions.resetState()
      this.onError?.(error)
    })

    this.provider.on('chainChanged', (chainId: string): void => {
      this.actions.update({ chainId: parseChainId(chainId) })
    })

    this.provider.on('accountsChanged', (accounts: string[]): void => {
      if (accounts.length === 0) {
        // handle this edge case by disconnecting
        this.actions.resetState()
      } else {
        this.actions.update({ accounts })
      }
    })
  }

  public watchAsset({
    address,
    symbol,
    decimals,
    image,
  }: Pick<WatchAssetParameters, 'address'> & Partial<Omit<WatchAssetParameters, 'address'>>): Promise<true> {
    if (!this.provider) throw new Error('No provider')

    return this.provider
      .request({
        method: 'wallet_watchAsset',
        params: [{
          type: 'ERC20',
          options: {
            address, // The address that the token is at.
            symbol, // A ticker symbol or shorthand, up to 5 chars.
            decimals, // The number of decimals in the token
            image, // A string url of the token logo
          },
        }],
      })
      .then((success) => {
        if (!success) throw new Error('Rejected')
        return true
      })
  }
}
